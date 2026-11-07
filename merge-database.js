require("dotenv").config();
const mongoose = require("mongoose");

const SOURCE_DATABASE = "dealifyhub246";
const DESTINATION_DATABASE = "cricket";
const APPLY = process.argv.includes("--apply");
const COLLECTIONS = [
    "tournaments",
    "matches",
    "players",
    "teams",
    "turfs",
    "sessions",
    "counters",
];

async function run() {
    await mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/cricket");
    const client = mongoose.connection.getClient();

    try {
        const source = client.db(SOURCE_DATABASE);
        const destination = client.db(DESTINATION_DATABASE);

        console.log(`Source:      ${SOURCE_DATABASE}`);
        console.log(`Destination: ${DESTINATION_DATABASE}`);

        for (const collectionName of COLLECTIONS) {
            const sourceCollection = source.collection(collectionName);
            const destinationCollection = destination.collection(collectionName);
            const sourceDocs = await sourceCollection.find({}).toArray();
            const destinationIds = await destinationCollection.distinct("_id", {
                _id: { $in: sourceDocs.map((doc) => doc._id) },
            });
            const destinationIdStrings = new Set(destinationIds.map(String));
            const newCount = sourceDocs.filter((doc) => !destinationIdStrings.has(String(doc._id))).length;
            const updateCount = sourceDocs.length - newCount;

            console.log(
                `${collectionName}: source=${sourceDocs.length}, replace=${updateCount}, insert=${newCount}`
            );

            if (!APPLY || !sourceDocs.length) continue;

            const operations = sourceDocs.map((doc) => ({
                replaceOne: {
                    filter: { _id: doc._id },
                    replacement: doc,
                    upsert: true,
                },
            }));
            const result = await destinationCollection.bulkWrite(operations, { ordered: false });
            console.log(
                `  copied: inserted=${result.upsertedCount}, replaced=${result.modifiedCount}`
            );
        }

        if (!APPLY) {
            console.log("Dry run only. Re-run with --apply to copy the collections.");
        } else {
            console.log("Database merge complete.");
        }
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((error) => {
    console.error("Failed to merge databases:", error.message);
    process.exitCode = 1;
});
