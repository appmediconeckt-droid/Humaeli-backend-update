

import mongoose from "../persistence/mongoose.js";

const sessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
       
    },
    refreshToken: {
        type: String,
        required: true,
        unique: true, 
    },
    isActive: {
        type: Boolean,
        default: true
    },
    // Updated by authenticated requests and the web heartbeat. This lets the
    // server expire a session left behind by a browser that closed abruptly.
    lastActivityAt: {
        type: Date,
        default: Date.now,
        index: true
    },
  
    logoutAt: {
        type: Date,
        default: null
    }
}, { 
    timestamps: true
});


export default mongoose.model("Session", sessionSchema);
