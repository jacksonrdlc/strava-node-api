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
let athleteId = '';

const runawayRunawayRefeshTokensUrl = "https://runaway-node-api-203308554831.us-central1.run.app/refresh-tokens"

// Add error handling helper
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

async function refreshAccessToken() {
    try {
        if (!athleteId) {
            throw new Error('No athlete ID available for token refresh');
        }

        // First get new tokens from runaway service
        const runawayResponse = await axios.get(`${runawayRunawayRefeshTokensUrl}/${athleteId}`)
            .catch(error => {
                throw new Error(`Failed to fetch from runaway service: ${error.message}`);
            });

        const storedRefreshToken = runawayResponse.data.refresh_token;
        if (!storedRefreshToken) {
            throw new Error('No refresh token found in runaway service');
        }

        // Use the stored refresh token to get new access token from Strava
        const tokenResponse = await axios.post('https://www.strava.com/oauth/token', querystring.stringify({
            client_id: clientID,
            client_secret: clientSecret,
            refresh_token: storedRefreshToken,
            grant_type: 'refresh_token'
        })).catch(error => {
            throw new Error(`Strava token refresh failed: ${error.response?.data?.message || error.message}`);
        });

        accessToken = tokenResponse.data.access_token;
        refreshToken = tokenResponse.data.refresh_token;
        tokenExpiresAt = tokenResponse.data.expires_at;

        // Update the stored tokens in runaway service
        await axios.post(runawayRunawayRefeshTokensUrl, {
            athlete_id: athleteId,
            refresh_token: refreshToken,
            access_token: accessToken,
            expires_at: tokenExpiresAt
        }).catch(error => {
            console.error('Failed to update runaway service:', error.message);
            // Continue execution even if update fails
        });

        console.log('Token refreshed successfully');
        return accessToken;
    } catch (error) {
        console.error('Token refresh failed:', {
            error: error.message,
            athleteId,
            tokenExpiresAt: new Date(tokenExpiresAt * 1000).toISOString()
        });
        throw error;
    }
}

async function ensureValidToken() {
    try {
        const now = Math.floor(Date.now() / 1000);
        if (now >= tokenExpiresAt) {
            console.log('Token expired, refreshing...');
            return await refreshAccessToken();
        }
        return accessToken;
    } catch (error) {
        console.error('Token validation failed:', error.message);
        throw new Error('Failed to ensure valid token');
    }
}

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

        // Get athlete ID for storage
        const athleteResponse = await axios.get('https://www.strava.com/api/v3/athlete', {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        }).catch(error => {
            throw new Error(`Failed to fetch athlete data: ${error.message}`);
        });
        console.log(athleteResponse.data);
        athleteId = athleteResponse.data.id;

        // Store token in runaway service
        await axios.post(runawayRunawayRefeshTokensUrl, {
            user_id: athleteId,
            refresh_token: refreshToken
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

    if (!refreshToken) {
        return res.send('You need to authenticate first by visiting the home page.');
    }

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
    if (!refreshToken) {
        return res.send('You need to authenticate first by visiting the home page.');
    }

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
    if (!refreshToken) {
        return res.send('You need to authenticate first by visiting the home page.');
    }

    try {
        const validToken = await ensureValidToken();
        // First get the authenticated athlete's ID
        const athleteResponse = await axios.get(`https://www.strava.com/api/v3/athlete`, {
            headers: {
                Authorization: `Bearer ${validToken}`
            }
        });

        const athleteId = athleteResponse.data.id;

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

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});