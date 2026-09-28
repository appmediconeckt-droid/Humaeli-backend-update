import { protect, allowRoles } from '../middleware/authMiddleware.js';
import express from 'express';
import {
    applyLeave,
    getUserLeaves,
    cancelLeave,
    getUserById,
    getAllLeaves,
    updateLeaveStatus,
    getPendingLeaves
} from '../controllers/leaveController.js';


const router = express.Router();
router.use(protect);

// All routes require authentication

// ========== USER ROUTES ==========
router.post('/apply-leave', applyLeave);           // Apply for leave
router.get('/my-leaves', getUserLeaves);           // Get my leaves
router.delete('/cancel-leave/:id', cancelLeave);   // Cancel my leave

// ========== ADMIN ROUTES ==========
router.get('/user/:user_id', getUserById);         // Get user by ID
router.get('/all-leaves', getAllLeaves);           // Get all leaves (all users)
router.get('/pending-leaves', getPendingLeaves);   // Get only pending leaves
router.put('/update-leave-status/:id', updateLeaveStatus); // Approve/Reject leave

export default router;
