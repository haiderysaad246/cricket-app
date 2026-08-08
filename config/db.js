const mongoose = require("mongoose");

const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/cricket";

async function connectDB() {
    try {
        await mongoose.connect(MONGO_URL);
        console.log("connect to db");
    } catch (err) {
        console.log(err);
    }
}

module.exports = connectDB;
