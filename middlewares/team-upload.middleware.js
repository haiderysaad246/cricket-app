const multer = require("multer");
const cloudinary = require("../config/cloudinary");
const { deleteImageFile } = require("../utils/fileHelper");

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
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB max
});

const teamLogoField = upload.fields([{ name: "logo", maxCount: 1 }]);

function uploadToCloudinary(file) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: "cricket/teams",
                transformation: [{ width: 400, height: 400, crop: "fill", gravity: "auto" }],
            },
            (err, result) => {
                if (err) return reject(err);
                resolve({ path: result.secure_url, filename: result.public_id });
            }
        );
        stream.end(file.buffer);
    });
}

// Wraps multer + the Cloudinary upload so errors return clean JSON instead
// of crashing the request.
function handleTeamLogoUpload(req, res, next) {
    teamLogoField(req, res, async (err) => {
        if (err) {
            let message = "Something went wrong while uploading the logo. Please try again.";
            if (err instanceof multer.MulterError) {
                if (err.code === "LIMIT_FILE_SIZE") {
                    message = "Logo image is too large. Please upload a file under 2MB.";
                } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
                    message = "Unexpected upload field. Please use only the logo field.";
                }
            } else if (err.message) {
                message = err.message;
            }
            return res.status(400).json({ error: message });
        }

        try {
            if (req.files?.logo) {
                const result = await uploadToCloudinary(req.files.logo[0]);
                req.files.logo[0].path = result.path;
                req.files.logo[0].filename = result.filename;
            }
            next();
        } catch (uploadErr) {
            console.log(uploadErr);
            if (req.files?.logo?.[0]?.filename) deleteImageFile(req.files.logo[0].filename);
            res.status(400).json({ error: "Something went wrong while uploading the logo. Please try again." });
        }
    });
}

module.exports = handleTeamLogoUpload;