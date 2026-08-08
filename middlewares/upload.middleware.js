const multer = require("multer");
const cloudinary = require("../config/cloudinary");
const { deleteImageFile } = require("../utils/fileHelper");

// Files are held in memory briefly, then streamed straight to Cloudinary
// below — nothing ever touches the server's local disk.
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Only JPG, PNG, or WEBP images are allowed"));
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB max per image
});

const playerImageFields = upload.fields([{ name: "image", maxCount: 1 }, { name: "image2", maxCount: 1 }]);

// Uploads an in-memory file buffer to Cloudinary. Every player photo is
// auto-cropped to a 500x500 square (gravity: "auto" picks the most
// interesting part of the image), replacing the old manual dimension check.
function uploadToCloudinary(file) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: "cricket/players",
                transformation: [{ width: 500, height: 500, crop: "fill", gravity: "auto" }],
            },
            (err, result) => {
                if (err) return reject(err);
                resolve({ path: result.secure_url, filename: result.public_id });
            }
        );
        stream.end(file.buffer);
    });
}

// Wraps multer + the Cloudinary upload so errors render a clean page instead
// of crashing the request.
function handlePlayerUpload(req, res, next) {
    playerImageFields(req, res, async (err) => {
        if (err) {
            let message = "Something went wrong while uploading the image. Please try again.";
            if (err instanceof multer.MulterError) {
                if (err.code === "LIMIT_FILE_SIZE") {
                    message = "One of your images is too large. Please upload a file under 2MB.";
                } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
                    message = "Unexpected upload field. Please use only the two provided image fields.";
                }
            } else if (err.message) {
                message = err.message;
            }
            return sendUploadError(req, res, message);
        }

        try {
            if (req.files?.image) {
                const result = await uploadToCloudinary(req.files.image[0]);
                req.files.image[0].path = result.path;
                req.files.image[0].filename = result.filename;
            }
            if (req.files?.image2) {
                const result = await uploadToCloudinary(req.files.image2[0]);
                req.files.image2[0].path = result.path;
                req.files.image2[0].filename = result.filename;
            }
            next();
        } catch (uploadErr) {
            console.log(uploadErr);
            // Clean up whichever image made it to Cloudinary before the other failed
            if (req.files?.image?.[0]?.filename) deleteImageFile(req.files.image[0].filename);
            if (req.files?.image2?.[0]?.filename) deleteImageFile(req.files.image2[0].filename);
            sendUploadError(req, res, "Something went wrong while uploading the image. Please try again.");
        }
    });
}

function sendUploadError(req, res, message) {
    if (req.originalUrl.startsWith("/api/")) {
        return res.status(400).json({ error: message });
    }
    if (req.params.id) {
        return res.status(400).render("players/edit.ejs", { player: null, error: message });
    }
    return res.status(400).render("players/new.ejs", { error: message, formData: req.body });
}

module.exports = handlePlayerUpload;