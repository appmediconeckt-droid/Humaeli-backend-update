import { protect, allowRoles } from '../middleware/authMiddleware.js';
import express from 'express';
import { 
    addMedication,
    getAllMedications,
    getMedicationById,
    updateMedicationStatus,
    updateMedication,
    deleteMedication,
    getMedicationsByStatus
} from '../controllers/medicationController.js';

const router = express.Router();
router.use(protect, allowRoles('doctor', 'admin', 'nurse'));

// Medication routes
router.post('/add-medication', addMedication);                    // Add new medication
router.get('/medications', getAllMedications);                    // Get all medications (with search)
router.get('/medication/:id', getMedicationById);                 // Get single medication by ID
router.get('/medications/status/:status', getMedicationsByStatus); // Get by status (given/pending/missed)
router.put('/update-medication/:id', updateMedication);           // Update full medication
router.patch('/update-status/:id', updateMedicationStatus);       // Update only status
router.delete('/delete-medication/:id', deleteMedication);        // Delete medication

export default router;
