# ChatRoom (Angular + Express + Socket.IO)

Real-time chat app with:
- JWT auth (register/login)
- Public room messaging
- Private 1:1 messaging with sent/delivered/read states
- Online user presence

## Project structure
- `Backend/` - Node.js, Express, Socket.IO, MongoDB (Mongoose)
- `Frontend/` - Angular standalone app, Angular Material UI

## Backend setup
1. Install dependencies:
```bash
cd Backend
npm install
```
2. Create env file from template:
```bash
copy .env.example .env
```
3. Configure `Backend/.env`:
```env
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/chatroom
JWT_SECRET=replace-with-a-strong-secret
CLIENT_URL=http://localhost:4200
```
4. Start backend:
```bash
npm run dev
```

Backend runs on `http://localhost:3000`.

## Frontend setup
1. Install dependencies:
```bash
cd Frontend
npm install
```
2. Start frontend:
```bash
npm start
```

Frontend runs on `http://localhost:4200`.

## Useful scripts

### Backend (`Backend/package.json`)
- `npm start` - start server
- `npm run dev` - start server with nodemon

### Frontend (`Frontend/package.json`)
- `npm start` - run Angular dev server
- `npm run build` - production build
- `npm test -- --watch=false --browsers=ChromeHeadless` - one-off test run

## Core API
- `POST /api/user/register` - create account
- `POST /api/user/login` - login and receive JWT
- `GET /api/me` - current user info (auth required)
- `GET /api/public` - public room history (`before`/`since` cursor support, auth required)
- `GET /api/private/unread-counts` - unread DM counters by sender (auth required)
- `GET /api/private/:username` - private chat history (`since` support, auth required)
- `GET /api/search?q=<text>` - search across public and your private messages (auth required)

## How to keep working on this
- Keep backend and frontend in separate terminals during development.
- Start by updating one vertical flow at a time (API -> socket event -> UI).
- Add tests for the flow you touch before moving on.
- Keep all frontend API URLs behind `environment.apiUrl`.
- Do not commit real `.env` files or secrets.
