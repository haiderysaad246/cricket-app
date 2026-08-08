const cloudinary = require("../config/cloudinary");

// Pulls the Cloudinary public_id out of either a full Cloudinary URL
// (what's stored on the player/team document) or a bare public_id
// (what multer-storage-cloudinary hands us right after an upload, for
// cleanup when a request fails partway through).
function extractPublicId(imagePathOrUrl) {
    if (!imagePathOrUrl) return null;
    if (!imagePathOrUrl.startsWith("http")) return imagePathOrUrl;
    const match = imagePathOrUrl.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:\?.*)?$/);
    return match ? match[1] : null;
}

// Deletes a previously uploaded image from Cloudinary. Safe to call with
// the local placeholder path (it's a no-op — nothing to delete in the cloud).
async function deleteImageFile(imagePathOrUrl) {
    if (!imagePathOrUrl || imagePathOrUrl.startsWith("/images/")) return;
    const publicId = extractPublicId(imagePathOrUrl);
    if (!publicId) return;
    try {
        await cloudinary.uploader.destroy(publicId);
    } catch (err) {
        console.log("Could not delete cloud image:", publicId, err.message);
    }
}

module.exports = { deleteImageFile };