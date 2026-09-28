import { protect, allowRoles } from '../middleware/authMiddleware.js';
import express from 'express';
import {
    createFollowUp,
    getAllFollowUps,
    getTodayFollowUps,
    getFollowUpById,
    updateFollowUp,
    deleteFollowUp,
} from '../controllers/followupController.js';

const router = express.Router();
router.use(protect, allowRoles('doctor', 'admin', 'assistant', 'nurse'));

// Routes
router.post('/', createFollowUp);
router.get('/', getAllFollowUps);
router.get('/today', getTodayFollowUps);
router.get('/:id', getFollowUpById);
router.put('/:id', updateFollowUp);
router.delete('/:id', deleteFollowUp);

export default router;
