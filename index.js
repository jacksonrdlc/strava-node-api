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

async function refreshAccessToken() {
    try {
        const tokenResponse = await axios.post('https://www.strava.com/oauth/token', querystring.stringify({
            client_id: clientID,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        }));

        accessToken = tokenResponse.data.access_token;
        refreshToken = tokenResponse.data.refresh_token;
        tokenExpiresAt = tokenResponse.data.expires_at;
        console.log('Token refreshed:', {
            accessToken: accessToken.substring(0, 10) + '...',
            refreshToken: refreshToken.substring(0, 10) + '...',
            expiresAt: new Date(tokenExpiresAt * 1000).toISOString()
        });
        return accessToken;
    } catch (error) {
        console.error('Error refreshing token:', error.message);
        throw error;
    }
}

async function ensureValidToken() {
    const now = Math.floor(Date.now() / 1000);
    console.log('Token expires at:', tokenExpiresAt);
    if (now >= tokenExpiresAt) {
        console.log('Refreshing token...');
        await refreshAccessToken();
    }
    return accessToken;
}

app.get('/', (req, res) => {
    const authURL = `https://www.strava.com/oauth/authorize?client_id=${clientID}&response_type=code&redirect_uri=${redirectURI}&scope=${scope}`;
    res.send(`<a href="${authURL}">Login with Strava</a>`);
});

app.get('/callback', async (req, res) => {
    const { code } = req.query;

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
        console.log('Initial token received:', {
            accessToken: accessToken.substring(0, 10) + '...',
            refreshToken: refreshToken.substring(0, 10) + '...',
            expiresAt: new Date(tokenExpiresAt * 1000).toISOString()
        });
        res.send(`Authentication successful! You can now fetch an activity by visiting /activity/:id`);
    } catch (error) {
        res.send(`Error: ${error.response?.data?.message || error.message}`);
    }
});

app.get('/activities', async (req, res) => {
    if (!refreshToken) {
        return res.send('You need to authenticate first by visiting the home page.');
    }

    try {
        const validToken = await ensureValidToken();
        const activityResponse = await axios.get(`https://www.strava.com/api/v3/activities`, {
            headers: {
                Authorization: `Bearer ${validToken}`
            }
        });
        res.json(activityResponse.data);
    } catch (error) {
        res.send(`Error: ${error.response?.data?.message || error.message}`);
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
        res.send(`Error: ${error.response?.data?.message || error.message}`);
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
        res.send(`Error: ${error.response?.data?.message || error.message}`);
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
        res.send(`Error: ${error.response?.data?.message || error.message}`);
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});