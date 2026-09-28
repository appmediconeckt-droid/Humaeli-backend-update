// routes/availabilityRoutes.js
import express from 'express';
import availabilityController from '../controllers/availabilityController.js';
import { protect, allowRoles } from '../middleware/authMiddleware.js';


const router = express.Router();
router.get('/available', availabilityController.getAvailableDates);
router.get('/ranges', availabilityController.getAllRanges);
router.use(protect, allowRoles('doctor', 'admin', 'assistant', 'nurse', 'department_manager'));
// GET all ranges and unavailable dates

// POST add new date range
router.post('/ranges', availabilityController.addDateRange.bind(availabilityController));

// PUT update date range
router.put('/ranges/:id', availabilityController.updateDateRange.bind(availabilityController));

// DELETE date range
router.delete('/ranges/:id', availabilityController.deleteDateRange.bind(availabilityController));

// POST mark specific date as unavailable
router.post('/unavailable', availabilityController.markDateUnavailable.bind(availabilityController));
router.delete('/unavailable', availabilityController.removeUnavailableDate);

// DELETE clear specific date range
router.delete('/clear-date', availabilityController.clearDateRange.bind(availabilityController));

// DELETE clear all unavailable dates
router.delete('/clear-all', availabilityController.clearAllRanges);
router.delete('/clear-all-unavailable', availabilityController.clearAllUnavailableDates.bind(availabilityController));

// GET available dates

export default router;
