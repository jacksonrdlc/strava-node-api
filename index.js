import express from 'express';
import axios from 'axios';
import querystring from 'querystring';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Middleware to get userId from session cookie
async function getUserId(req, res, next) {
    const sessionId = req.cookies?.sessionId;

    if (!sessionId) {
        req.userId = null;
        return next();
    }

    try {
        const response = await axios.get(`${runawayTokensUrl}/sessions/${sessionId}`);
        req.userId = response.data.user_id;
    } catch (error) {
        console.error('Failed to get userId from session:', error.message);
        req.userId = null;
    }

    next();
}

app.use(getUserId);
const port = parseInt(process.env.PORT) || 8080;

const clientID = process.env.STRAVA_CLIENT_ID;
const clientSecret = process.env.STRAVA_CLIENT_SECRET;
const redirectURI = process.env.NODE_ENV === 'production'
    ? `https://strava-node-api-203308554831.us-central1.run.app/callback`
    : `http://localhost:${port}/callback`;
const scope = 'read,activity:read_all';

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

        const accessToken = tokenResponse.data.access_token;
        const refreshToken = tokenResponse.data.refresh_token;
        const tokenExpiresAt = tokenResponse.data.expires_at;

        // const tokenExpiresAtDate = new Date(tokenExpiresAt * 1000);

        // console.log('Token expires at:', tokenExpiresAtDate);

        // Get user ID from Strava
        const athleteResponse = await axios.get('https://www.strava.com/api/v3/athlete', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const userId = athleteResponse.data.id.toString();

        const authResponse = await axios.get(`${runawayTokensUrl}/auth/${userId}`);
        console.log('authResponse:', authResponse.data);

        const authId = authResponse.data.auth_id;

        // Generate session ID and store userId mapping in runaway service
        const sessionId = crypto.randomBytes(32).toString('hex');

        console.log('userId:', userId);
        console.log('sessionId:', sessionId);
        console.log('authId:', authId);

        // Store session mapping
        await axios.post(`${runawayTokensUrl}/sessions`, {
            session_id: sessionId,
            user_id: userId,
            auth_id: authId
        }).catch(error => {
            console.error('Failed to store session in runaway service:', error.message);
        });

        // Set session cookie
        res.cookie('sessionId', sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });

        // Store token in runaway service
        await axios.post(`${runawayTokensUrl}/tokens`, {
            user_id: userId,
            refresh_token: refreshToken,
            access_token: accessToken,
            expires_at: tokenExpiresAt
        }).catch(error => {
            console.error('Failed to store tokens in runaway service:', error.message);
            // Continue execution even if storage fails
        });

        res.send('Authentication successful! You can now use the API.');
    } catch (error) {
        console.error('Error during authentication:', error.message);
        handleError(error, res);
    }
});

app.get('/activities', async (req, res) => {
    console.log('/activities called');
    try {
        if (!req.userId) {
            return res.status(401).send('Please authenticate first by visiting the home page');
        }

        const validToken = await ensureValidToken(req.userId);
        const activityResponse = await axios.get('https://www.strava.com/api/v3/activities', {
            headers: { Authorization: `Bearer ${validToken}` }
        });

        res.json(activityResponse.data);
    } catch (error) {
        handleError(error, res);
    }
});

app.get('/activities/:userId/:id', async (req, res) => {
    console.log('/activities/:userId/:id called');
    const { userId, id } = req.params;

    console.log('userId:', userId);
    console.log('activityId:', id);

    try {
        console.log('req.userId:', userId);
        if (!userId) {
            return res.status(401).send('Please authenticate first by visiting the home page');
        }

        const validToken = await ensureValidToken(userId);
        console.log('validToken:', validToken);
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

app.get(`/athlete/:userId`, async (req, res) => {
    console.log('/athlete called');
    const { userId } = req.params;
    try {
        if (!userId) {
            return res.status(401).send('Please authenticate first by visiting the home page');
        }

        const validToken = await ensureValidToken(userId);
        const athleteResponse = await axios.get(`https://www.strava.com/api/v3/athlete`, {
            headers: {
                Authorization: `Bearer ${validToken}`
            }
        });
        console.log('athleteResponse:', athleteResponse);
        console.log('athleteResponse.data:', athleteResponse.data);
        res.json(athleteResponse.data);
    } catch (error) {
        handleError(error, res);
    }
});

app.get('/athlete/stats/:userId', async (req, res) => {
    console.log('/athlete/stats called');
    const { userId } = req.params;
    try {
        if (!userId) {
            return res.status(401).send('Please authenticate first by visiting the home page');
        }

        console.log('userId:', userId);

        const validToken = await ensureValidToken(userId);

        // Then get their stats
        const statsResponse = await axios.get(`https://www.strava.com/api/v3/athletes/${userId}/stats`, {
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
    console.log('/tokens/:userId called');
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

app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});

async function ensureValidToken(userId) {
    try {
        if (!userId) {
            throw new Error('User ID is required');
        }

        const now = Math.floor(Date.now() / 1000);

        // First try to get tokens from runaway service
        try {
            const runawayResponse = await axios.get(`${runawayTokensUrl}/tokens/${userId}`);
            console.log('Tokens retrieved from runaway service');

            const storedExpiresAt = runawayResponse.data.expires_at;

            if (now < storedExpiresAt) {
                console.log('Using valid token from runaway service');
                return runawayResponse.data.access_token;
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

        const newAccessToken = tokenResponse.data.access_token;
        const newRefreshToken = tokenResponse.data.refresh_token;

        console.log('athleteId:', athleteId);

        // Update the stored tokens in runaway service
        await axios.post(`${runawayTokensUrl}/tokens`, {
            user_id: athleteId,
            access_token: newAccessToken,
            refresh_token: newRefreshToken,
            expires_at: tokenResponse.data.expires_at
        }).catch(error => {
            console.error('Failed to update runaway service:', error.message);
            // Continue execution even if update fails
        });

        console.log('Token refreshed successfully');
        return newAccessToken;
    } catch (error) {
        console.error('Token refresh failed:', {
            error: error.message,
            athleteId
        });
        throw error;
    }
}