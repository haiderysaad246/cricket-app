require("dotenv").config();

const fs = require("fs");
const express = require("express");
const path = require("path");

const connectDB = require("./config/db");
const pageRoutes = require("./routes/page.routes");
const playerRoutes = require("./routes/player.routes"); // legacy EJS fallback (used until `client/` is built)
const playersApiRoutes = require("./routes/players.api.routes");
const teamsApiRoutes = require("./routes/teams.api.routes");
const turfRoutes = require("./routes/turf.routes");
const tclRoutes = require("./routes/tcl.routes");
const pointsRoutes = require("./routes/points.routes");
const authRoutes = require("./routes/auth.routes");
const { attachRole } = require("./middlewares/auth.middleware");

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_DIST = path.join(__dirname, "client", "dist");
const hasReactBuild = fs.existsSync(path.join(CLIENT_DIST, "index.html"));

connectDB();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.match(/\.(css|js)$/)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(attachRole);

// Make the current URL path available in every EJS template as `currentPath`
app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    next();
});

app.use("/", authRoutes);
app.use("/", pageRoutes);
app.use("/api/players", playersApiRoutes);
app.use("/api/teams", teamsApiRoutes); // JSON API for React — admin-gated per-route (create/edit/delete), like players
app.use("/tcl", tclRoutes); // TCL tournament folders + fixtures; live scoring reuses /turfs/live/:id
app.use("/points", pointsRoutes);

if (hasReactBuild) {
    // React (Vite build) now owns everything under /players and /teams
    // (list pages + all their sub-routes have real React routes).
    app.use(express.static(CLIENT_DIST));
    app.get(/^\/(players|teams)(\/.*)?$/, (req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
} else {
    console.log("client/dist not found — run `cd client && npm install && npm run build`. Falling back to legacy EJS pages for /players for now.");
    app.use("/players", playerRoutes);
}

// Live Match scoring is shared by TCL; the standalone Turf folder/session UI is not mounted.
app.use("/turfs", turfRoutes);

app.listen(PORT, () => {
    console.log("server is listening to port " + PORT);
});