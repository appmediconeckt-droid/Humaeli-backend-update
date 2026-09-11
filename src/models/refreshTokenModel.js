// // models/refreshTokenModel.js
// import mongoose from "../persistence/mongoose.js";

// const refreshTokenSchema = new mongoose.Schema({
//     token: {
//         type: String,
//         required: true,
//         unique: true
//     },
//     userId: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "User",
//         required: true
//     },
//     // No expiresAt field - tokens live forever until manual logout
//     userAgent: {
//         type: String,
//         default: null
//     },
//     ipAddress: {
//         type: String,
//         default: null
//     }
// }, { 
//     timestamps: true // createdAt & updatedAt
// });

// // Index for faster queries
// refreshTokenSchema.index({ userId: 1 });
// refreshTokenSchema.index({ token: 1 });

// export default mongoose.model("RefreshToken", refreshTokenSchema);

// Delete this file entirely if you're not using it
// Or if you need it, fix the duplicate index:

// import mongoose from "../persistence/mongoose.js";

// const refreshTokenSchema = new mongoose.Schema({
//     token: {
//         type: String,
//         required: true,
//         unique: true
      
//     },
//     userId: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "User",
//         required: true
//     },
//     userAgent: {
//         type: String,
//         default: null
//     },
//     ipAddress: {
//         type: String,
//         default: null
//     }
// }, { 
//     timestamps: true
// });

// // Define indexes separately
// refreshTokenSchema.index({ userId: 1 });
// refreshTokenSchema.index({ token: 1 });

// export default mongoose.model("RefreshToken", refreshTokenSchema);
import mongoose from "../persistence/mongoose.js";

const refreshTokenSchema = new mongoose.Schema({
    token: {
        type: String,
        required: true,
        unique: true  // This automatically creates an index
        // No need to add index separately
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
        // If you need to query by userId frequently, add index: true here
        // index: true
    },
    userAgent: {
        type: String,
        default: null
    },
    ipAddress: {
        type: String,
        default: null
    }
}, { 
    timestamps: true
});

// Only add indexes for fields that don't have unique or index set in schema
// Since token already has unique: true, it already has an index
// Add userId index if you frequently query by userId
refreshTokenSchema.index({ userId: 1 });  // ✅ Keep this for userId if needed

// ❌ Remove this line since token already has unique: true which creates an index
// refreshTokenSchema.index({ token: 1 });  // DELETE THIS LINE

export default mongoose.model("RefreshToken", refreshTokenSchema);