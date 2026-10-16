# Mchango wa Send Off - Lidya Shauri (Railway + MongoDB)

Mfumo ni Node.js server moja (`server.js`) inayotoa kurasa (`index.html`, `admin.html`) na API (`/api/*`). Files zote ziko kwenye folda moja (flat).

## Deploy Railway
1. Weka folda hii kwenye GitHub (`.env` haipandi kwa sababu iko `.gitignore`).
2. Railway > New Project > Deploy from GitHub repo.
3. Service > Variables, ongeza: `MONGODB_URI`, `DB_NAME` (lidya), `ADMIN_USER`, `ADMIN_PASS`, `JWT_SECRET`.
4. Service > Settings > Networking > Generate Domain.
   - Wageni: `https://JINA.up.railway.app`
   - Admin: `https://JINA.up.railway.app/admin`

## MongoDB Atlas
Network Access ruhusu `0.0.0.0/0` (Railway haina IP isiyobadilika).

## Local
```
npm install
npm start      # http://localhost:3000
```
(inasoma `.env` kama ipo)

## Usalama
- Credentials ziko kwenye Variables tu; data zote ziko MongoDB.
- Mchango hauhesabiwi hadi admin athibitishe (Approve).
