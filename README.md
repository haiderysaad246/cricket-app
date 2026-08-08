# Cricket

Same app, same UI, same behavior — just reorganized into a clean, layered
(MVC-style) structure instead of one giant `app.js`.

## What changed (and what didn't)

**Did NOT change:** any UI, colors, sizes, layout, CSS, client-side JS,
routes, validation rules, error messages, or database behavior. Every EJS
template renders byte-identical HTML to the original (verified by rendering
both versions with the same data and diffing the output).

**Did change:** where the code lives.

- `app.js` used to contain ~200 lines mixing server setup, multer config,
  file-deletion helpers, and every route handler. It's now a ~25-line file
  that just wires things together.
- Route handlers were split out into **controllers**.
- URL definitions were split out into **routes**.
- The image-upload/multer setup became its own **middleware**.
- The "delete a file from disk" helper became a small **util**.
- The Mongo connection became its own **config** module.
- The one-off DB seeding script moved into `seed/` and got a proper
  `npm run seed` command.
- The three EJS pages repeated the same `<head>` and Bootstrap `<script>`
  tag three times each — those are now shared partials
  (`views/includes/head.ejs`, `views/includes/scripts.ejs`) included by
  each page, cutting the duplication without touching what's rendered.

## Folder structure

```
cricket/
├── app.js                     # entry point — creates the app, mounts routes, starts the server
├── package.json
├── config/
│   └── db.js                  # MongoDB connection
├── models/
│   └── player.model.js         # Mongoose schema (kept as "players" model/collection)
├── controllers/
│   ├── player.controller.js    # list / new / create / edit / update / delete
│   └── page.controller.js      # /, /turfs, /tcl, /auction placeholders
├── routes/
│   ├── player.routes.js         # mounted at /players
│   └── page.routes.js           # mounted at /
├── middlewares/
│   └── upload.middleware.js     # multer config + upload error handling
├── utils/
│   └── fileHelper.js            # deleteImageFile()
├── seed/
│   ├── seedData.js              # sample players
│   └── seed.js                  # run with `npm run seed`
├── public/
│   ├── css/style.css            # unchanged
│   └── uploads/                 # unchanged
└── views/
    ├── includes/
    │   ├── head.ejs              # shared <head> (Bootstrap/FontAwesome/style.css)
    │   ├── scripts.ejs            # shared Bootstrap JS <script> tag
    │   └── navbar.ejs             # unchanged
    └── players/
        ├── index.ejs
        ├── new.ejs
        └── edit.ejs
```

## Running it

`node_modules` was not included in this zip (to keep it small) — reinstall
dependencies first:

```bash
npm install
npm start          # starts the server on port 3000 (same as before)
npm run seed        # optional: wipes players and inserts 2 sample players
```

Make sure MongoDB is running locally at `mongodb://127.0.0.1:27017/cricket`
(same connection string as the original app), or set a `MONGO_URL`
environment variable to point elsewhere.
