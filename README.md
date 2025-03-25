# Strava API Integration Service

A Node.js service that integrates with Strava's API to fetch athlete and activity data. This service handles OAuth2 authentication with Strava and manages token refresh flows using a separate token storage service.

## Technologies Used

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: JavaScript (ES Modules)
- **Dependencies**:
  - `express`: Web server framework
  - `axios`: HTTP client
  - `cors`: Cross-Origin Resource Sharing middleware
  - `dotenv`: Environment variable management
  - `querystring`: URL query string handling

## Prerequisites

- Node.js (v14 or higher)
- A Strava API application (Client ID and Secret)
- Access to the Runaway Tokens Service

## Environment Variables

Create a `.env` file in the root directory with:

```env
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret
PORT=8080 # optional, defaults to 8080
NODE_ENV=development # or production
```

## Installation

```bash
# Clone the repository
git clone [your-repo-url]

# Install dependencies
npm install
```

## Running the Application

```bash
# Development mode
npm run dev

# Production mode
npm start
```

The server will start at `http://localhost:8080` (or your configured PORT).

## API Endpoints

- `GET /`: Authentication entry point
- `GET /callback`: Strava OAuth callback URL
- `GET /activities`: List user's activities
- `GET /activity/:id`: Get specific activity details
- `GET /athlete`: Get authenticated athlete's profile
- `GET /athlete/stats`: Get athlete's statistics
- `GET /tokens/:userId`: Get stored tokens for a user

## Downstream Dependencies

This service depends on:
1. **Strava API** (`https://www.strava.com/api/v3/`)
   - Used for athlete and activity data
   - Requires OAuth2 authentication

2. **Runaway Tokens Service** (`https://runaway-node-api-203308554831.us-central1.run.app`)
   - Manages token storage and refresh
   - Endpoints used:
     - `/tokens`: Store and retrieve tokens
     - `/refresh-tokens`: Handle token refresh operations

## Authentication Flow

1. User visits `/` and clicks "Login with Strava"
2. User authenticates with Strava
3. Strava redirects to `/callback` with auth code
4. Service exchanges code for tokens
5. Tokens are stored in Runaway Tokens Service
6. Subsequent requests use stored tokens
7. Tokens are automatically refreshed when expired

## Development Notes

- Uses ES Modules (type: "module" in package.json)
- CORS enabled for all origins
- Automatic token refresh handling
- Error handling for API and token operations

## Error Handling

The service includes comprehensive error handling for:
- Token expiration
- API failures
- Token refresh failures
- Missing authentication
- Invalid requests

## Security Notes

- Tokens are stored in external service
- Client credentials in environment variables
- Sensitive data logged with partial masking
- CORS enabled for development 