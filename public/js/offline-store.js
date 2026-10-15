(function () {
    const DB_NAME = "cricket-offline";
    const DB_VERSION = 2;
    let dbPromise;

    function openDatabase() {
        if (!("indexedDB" in window)) {
            return Promise.reject(new Error("Offline storage is not available in this browser."));
        }
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains("pendingBalls")) {
                        const store = db.createObjectStore("pendingBalls", { keyPath: "operationId" });
                        store.createIndex("createdAt", "createdAt");
                    }
                    if (!db.objectStoreNames.contains("matchSnapshots")) {
                        db.createObjectStore("matchSnapshots", { keyPath: "matchId" });
                    }
                    if (!db.objectStoreNames.contains("metadata")) {
                        db.createObjectStore("metadata", { keyPath: "key" });
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error || new Error("Could not open offline storage."));
            });
        }
        return dbPromise;
    }

    async function read(storeName, method, key) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const request = db.transaction(storeName, "readonly").objectStore(storeName)[method](key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("Could not read offline storage."));
        });
    }

    async function saveBall(operation, match) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(["pendingBalls", "matchSnapshots", "metadata"], "readwrite");
            const metadata = tx.objectStore("metadata");
            const sequenceRequest = metadata.get("lastSequence");
            sequenceRequest.onsuccess = () => {
                operation.sequence = Math.max(Date.now(), Number(sequenceRequest.result?.value || 0) + 1);
                metadata.put({ key: "lastSequence", value: operation.sequence });
                tx.objectStore("pendingBalls").put(operation);
                tx.objectStore("matchSnapshots").put({ matchId: String(match._id), match });
            };
            sequenceRequest.onerror = () => tx.abort();
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error("Could not save the score on this device."));
            tx.onabort = () => reject(tx.error || new Error("Could not save the score on this device."));
        });
    }

    async function getPendingBalls() {
        const rows = await read("pendingBalls", "getAll");
        return rows.sort((a, b) => (a.sequence || a.createdAt) - (b.sequence || b.createdAt));
    }

    async function saveSyncedMatch(operationId, match) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(["pendingBalls", "matchSnapshots"], "readwrite");
            tx.objectStore("pendingBalls").delete(operationId);
            tx.objectStore("matchSnapshots").put({ matchId: String(match._id), match });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error("Could not update the saved score."));
            tx.onabort = () => reject(tx.error || new Error("Could not update the saved score."));
        });
    }

    async function removePendingBall(operationId, match) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(["pendingBalls", "matchSnapshots"], "readwrite");
            tx.objectStore("pendingBalls").delete(operationId);
            tx.objectStore("matchSnapshots").put({ matchId: String(match._id), match });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error("Could not undo the saved score."));
            tx.onabort = () => reject(tx.error || new Error("Could not undo the saved score."));
        });
    }

    async function saveMatch(match) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("matchSnapshots", "readwrite");
            tx.objectStore("matchSnapshots").put({ matchId: String(match._id), match });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error("Could not save the match on this device."));
            tx.onabort = () => reject(tx.error || new Error("Could not save the match on this device."));
        });
    }

    window.OfflineStore = {
        getMatch: (matchId) => read("matchSnapshots", "get", String(matchId)),
        getPendingBalls,
        saveBall,
        saveMatch,
        saveSyncedMatch,
        removePendingBall,
    };
}());
