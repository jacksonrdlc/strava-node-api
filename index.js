import express from 'express';
import axios from 'axios';
import querystring from 'querystring';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
const port = parseInt(process.env.PORT) || 8080;

const clientID = process.env.STRAVA_CLIENT_ID;
const clientSecret = process.env.STRAVA_CLIENT_SECRET;
const redirectURI = process.env.NODE_ENV === 'production'
    ? `https://strava-node-api-203308554831.us-central1.run.app/callback`
    : `http://localhost:${port}/callback`;
const scope = 'read,activity:read_all';
let accessToken = '';
let refreshToken = '';
let tokenExpiresAt = 0;

const runawayTokensUrl = "https://runaway-node-api-203308554831.us-central1.run.app"

app.get('/', (req, res) => {
    const authURL = `https://www.strava.com/oauth/authorize?client_id=${clientID}&response_type=code&redirect_uri=${redirectURI}&scope=${scope}`;
    res.send(`<a href="${authURL}">Login with Strava</a>`);
});

app.get('/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('Authorization code is required');
    }

    try {
        const tokenResponse = await axios.post('https://www.strava.com/oauth/token', querystring.stringify({
            client_id: clientID,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code'
        }));

        accessToken = tokenResponse.data.access_token;
        refreshToken = tokenResponse.data.refresh_token;
        tokenExpiresAt = tokenResponse.data.expires_at;

        const tokenExpiresAtDate = new Date(tokenExpiresAt * 1000);

        console.log('Token expires at:', tokenExpiresAtDate);

        const userId = '6819d431-f5c8-4ac6-b59b-67d2010e1e04';

        // Store token in runaway service
        await axios.post(`${runawayTokensUrl}/tokens`, {
            user_id: userId,
            refresh_token: refreshToken,
            access_token: accessToken,
            expires_at: tokenExpiresAtDate
        }).catch(error => {
            console.error('Failed to store tokens in runaway service:', error.message);
            // Continue execution even if storage fails
        });

        res.send('Authentication successful! You can now use the API.');
    } catch (error) {
        handleError(error, res);
    }
});

app.get('/activities', async (req, res) => {
    try {
        if (!refreshToken) {
            return res.status(401).send('Please authenticate first by visiting the home page');
        }

        const validToken = await ensureValidToken();
        const activityResponse = await axios.get('https://www.strava.com/api/v3/activities', {
            headers: { Authorization: `Bearer ${validToken}` }
        });

        res.json(activityResponse.data);
    } catch (error) {
        handleError(error, res);
    }
});

app.get('/activities/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const validToken = await ensureValidToken();
        const activityResponse = await axios.get(`https://www.strava.com/api/v3/activities/${id}`, {
            headers: {
                Authorization: `Bearer ${validToken}`
            }
        });
        res.json(activityResponse.data);
    } catch (error) {
        handleError(error, res);
    }
});

app.get('/athlete', async (req, res) => {
    try {
        const validToken = await ensureValidToken();
        const athleteResponse = await axios.get(`https://www.strava.com/api/v3/athlete`, {
            headers: {
                Authorization: `Bearer ${validToken}`
            }
        });
        res.json(athleteResponse.data);
    } catch (error) {
        handleError(error, res);
    }
});

app.get('/athlete/stats', async (req, res) => {
    try {
        const validToken = await ensureValidToken();

        // Then get their stats
        const statsResponse = await axios.get(`https://www.strava.com/api/v3/athletes/${athleteId}/stats`, {
            headers: {
                Authorization: `Bearer ${validToken}`
            }
        });

        res.json(statsResponse.data);
    } catch (error) {
        handleError(error, res);
    }
});

app.get('/tokens/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).send('User ID is required');
        }

        // Get tokens from runaway service
        const runawayResponse = await axios.get(`${runawayTokensUrl}/tokens/${userId}`)
            .catch(error => {
                throw new Error(`Failed to fetch tokens from runaway service: ${error.message}`);
            });

        // Log token info (first 10 chars only for security)
        console.log('Tokens retrieved:', {
            accessToken: runawayResponse.data.access_token?.substring(0, 10) + '...',
            userId: userId
        });

        res.json({
            access_token: runawayResponse.data.access_token,
            expires_at: runawayResponse.data.expires_at
        });
    } catch (error) {
        handleError(error, res);
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

async function ensureValidToken() {
    try {
        const userId = '6819d431-f5c8-4ac6-b59b-67d2010e1e04'; // Using the hardcoded userId
        const now = Math.floor(Date.now() / 1000);

        // First try to get tokens from runaway service
        try {
            const runawayResponse = await axios.get(`${runawayTokensUrl}/tokens/${userId}`);
            console.log('Tokens retrieved from runaway service');

            const storedExpiresAt = runawayResponse.data.expires_at;

            if (now < storedExpiresAt) {
                console.log('Using valid token from runaway service');
                // Use the stored access token since it's still valid
                accessToken = runawayResponse.data.access_token;
                tokenExpiresAt = storedExpiresAt;
                return accessToken;
            }

            console.log('Stored token expired, refreshing...');
            return await refreshAccessToken(userId);
        } catch (error) {
            console.error('Failed to get tokens from runaway service:', error.message);
            // If we can't get tokens from runaway service, try refreshing
            return await refreshAccessToken(userId);
        }
    } catch (error) {
        console.error('Token validation failed:', error.message);
        throw new Error('Failed to ensure valid token');
    }
}

function handleError(error, res) {
    console.error('Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
    });

    if (error.response?.status === 401) {
        return res?.send('Authentication expired. Please login again at the home page.');
    }

    const errorMessage = error.response?.data?.message || error.message;
    return res?.send(`Error: ${errorMessage}`);
}

async function refreshAccessToken(athleteId) {
    try {
        if (!athleteId) {
            throw new Error('No athlete ID available for token refresh');
        }

        // First get new tokens from runaway service
        const runawayResponse = await axios.get(`${runawayTokensUrl}/refresh-tokens/${athleteId}`)
            .catch(error => {
                throw new Error(`Failed to fetch from runaway service: ${error.message}`);
            });

        console.log('Runaway response:', runawayResponse.data);

        const storedRefreshToken = runawayResponse.data.refresh_token;
        if (!storedRefreshToken) {
            throw new Error('No refresh token found in runaway service');
        }

        console.log('Stored refresh token:', storedRefreshToken);
        console.log('Client ID:', clientID);
        console.log('Client secret:', clientSecret);

        // Use the stored refresh token to get new access token from Strava
        const tokenResponse = await axios.post('https://www.strava.com/oauth/token', querystring.stringify({
            client_id: clientID,
            client_secret: clientSecret,
            refresh_token: storedRefreshToken,
            grant_type: 'refresh_token'
        })).catch(error => {
            throw new Error(`Strava token refresh failed: ${error.response?.data?.message || error.message}`);
        });

        console.log('Token response:', tokenResponse.data);

        accessToken = tokenResponse.data.access_token;
        refreshToken = tokenResponse.data.refresh_token;

        // Update the stored tokens in runaway service
        await axios.post(`${runawayTokensUrl}/refresh-tokens`, {
            user_id: athleteId,
            refresh_token: refreshToken
        }).catch(error => {
            console.error('Failed to update runaway service:', error.message);
            // Continue execution even if update fails
        });

        console.log('Token refreshed successfully');
        return accessToken;
    } catch (error) {
        console.error('Token refresh failed:', {
            error: error.message,
            athleteId
        });
        throw error;
    }
}