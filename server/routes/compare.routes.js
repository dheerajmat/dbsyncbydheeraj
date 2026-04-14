import express from 'express';
import { 
  handleDirectCompare, 
  handleGenerateSQL, 
  handleGeneratePrompt,
  handleExecuteSync 
} from '../controllers/compare.controller.js';

const router = express.Router();

router.post('/direct', handleDirectCompare);
router.post('/generate-sql', handleGenerateSQL);
router.post('/generate-prompt', handleGeneratePrompt);
router.post('/execute', handleExecuteSync);

export default router;
