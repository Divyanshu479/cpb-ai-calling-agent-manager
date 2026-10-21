import { AppError } from '../middleware/errorHandler.js';
import KnowledgeBase from '../models/KnowledgeBase.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = 'uploads/knowledge';
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /pdf|txt|doc|docx|md/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new AppError('Only PDF, TXT, DOC, DOCX, and MD files are allowed', 400));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// @desc    Get all knowledge base documents for logged in user
// @route   GET /api/knowledge
// @access  Private
export const getKnowledgeBases = async (req, res, next) => {
  try {
    const { search, status } = req.query;
    const query = { createdBy: req.user._id };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    if (status) {
      query.status = status;
    }

    const knowledgeBases = await KnowledgeBase.find(query).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: knowledgeBases.length,
      data: knowledgeBases,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single knowledge base document
// @route   GET /api/knowledge/:id
// @access  Private
export const getKnowledgeBase = async (req, res, next) => {
  try {
    const knowledgeBase = await KnowledgeBase.findById(req.params.id);

    if (!knowledgeBase) {
      return next(new AppError('Knowledge base document not found', 404));
    }

    // Check ownership
    if (knowledgeBase.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to access this document', 403));
    }

    res.status(200).json({
      success: true,
      data: knowledgeBase,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload and create knowledge base document
// @route   POST /api/knowledge
// @access  Private
export const createKnowledgeBase = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError('Please upload a file', 400));
    }

    const { name, description } = req.body;

    const knowledgeBase = await KnowledgeBase.create({
      name: name || req.file.originalname,
      description: description || '',
      fileName: req.file.originalname,
      filePath: req.file.path,
      fileSize: req.file.size,
      fileType: path.extname(req.file.originalname).substring(1),
      createdBy: req.user._id,
      status: 'processing',
    });

    // Process document asynchronously (extract text, create embeddings)
    processDocument(knowledgeBase._id).catch((err) =>
      console.error('Error processing document:', err)
    );

    res.status(201).json({
      success: true,
      data: knowledgeBase,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update knowledge base document
// @route   PUT /api/knowledge/:id
// @access  Private
export const updateKnowledgeBase = async (req, res, next) => {
  try {
    let knowledgeBase = await KnowledgeBase.findById(req.params.id);

    if (!knowledgeBase) {
      return next(new AppError('Knowledge base document not found', 404));
    }

    // Check ownership
    if (knowledgeBase.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to update this document', 403));
    }

    const { name, description } = req.body;

    knowledgeBase = await KnowledgeBase.findByIdAndUpdate(
      req.params.id,
      { name, description },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      data: knowledgeBase,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete knowledge base document
// @route   DELETE /api/knowledge/:id
// @access  Private
export const deleteKnowledgeBase = async (req, res, next) => {
  try {
    const knowledgeBase = await KnowledgeBase.findById(req.params.id);

    if (!knowledgeBase) {
      return next(new AppError('Knowledge base document not found', 404));
    }

    // Check ownership
    if (knowledgeBase.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to delete this document', 403));
    }

    // Delete file from disk
    try {
      await fs.unlink(knowledgeBase.filePath);
    } catch (err) {
      console.error('Error deleting file:', err);
    }

    await knowledgeBase.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Knowledge base document deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Search knowledge base
// @route   POST /api/knowledge/search
// @access  Private
export const searchKnowledge = async (req, res, next) => {
  try {
    const { query, knowledgeBaseIds, limit = 5 } = req.body;

    if (!query) {
      return next(new AppError('Search query is required', 400));
    }

    // Build filter
    const filter = { createdBy: req.user._id, status: 'completed' };
    if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
      filter._id = { $in: knowledgeBaseIds };
    }

    const knowledgeBases = await KnowledgeBase.find(filter);

    if (knowledgeBases.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    // Simple text search across chunks (mock vector search)
    const results = [];
    for (const kb of knowledgeBases) {
      if (kb.chunks && kb.chunks.length > 0) {
        for (const chunk of kb.chunks) {
          // Simple keyword matching
          const lowerChunk = chunk.text.toLowerCase();
          const lowerQuery = query.toLowerCase();

          if (lowerChunk.includes(lowerQuery)) {
            // Calculate simple relevance score
            const words = lowerQuery.split(' ');
            let score = 0;
            words.forEach(word => {
              const matches = (lowerChunk.match(new RegExp(word, 'g')) || []).length;
              score += matches;
            });

            results.push({
              knowledgeBaseId: kb._id,
              knowledgeBaseName: kb.name,
              chunkId: chunk.id,
              text: chunk.text,
              score,
              metadata: chunk.metadata,
            });
          }
        }
      }
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);
    const limitedResults = results.slice(0, limit);

    res.status(200).json({
      success: true,
      count: limitedResults.length,
      data: limitedResults,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Process document asynchronously
 * Extract text and create chunks
 */
async function processDocument(knowledgeBaseId) {
  try {
    const knowledgeBase = await KnowledgeBase.findById(knowledgeBaseId);
    if (!knowledgeBase) {
      throw new Error('Knowledge base not found');
    }

    // Read file content
    const content = await fs.readFile(knowledgeBase.filePath, 'utf-8');

    // Simple text chunking (split by paragraphs or every 500 characters)
    const chunks = chunkText(content, 500);

    // Create chunk objects with metadata
    const chunkObjects = chunks.map((text, index) => ({
      id: `chunk_${index}`,
      text,
      metadata: {
        chunkIndex: index,
        fileName: knowledgeBase.fileName,
      },
    }));

    // Update knowledge base with chunks
    knowledgeBase.chunks = chunkObjects;
    knowledgeBase.chunkCount = chunkObjects.length;
    knowledgeBase.status = 'completed';
    knowledgeBase.processedAt = new Date();

    await knowledgeBase.save();

    console.log(`[Knowledge Base] Document ${knowledgeBaseId} processed: ${chunkObjects.length} chunks`);
  } catch (error) {
    console.error(`[Knowledge Base] Error processing document ${knowledgeBaseId}:`, error);

    // Mark as failed
    try {
      await KnowledgeBase.findByIdAndUpdate(knowledgeBaseId, {
        status: 'failed',
        error: error.message,
      });
    } catch (updateError) {
      console.error('Error updating knowledge base status:', updateError);
    }
  }
}

/**
 * Chunk text into smaller pieces
 */
function chunkText(text, maxChunkSize = 500) {
  const chunks = [];

  // Split by paragraphs first
  const paragraphs = text.split(/\n\n+/);

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();

    if (!trimmedParagraph) continue;

    // If paragraph is too large, split it further
    if (trimmedParagraph.length > maxChunkSize) {
      // Save current chunk if exists
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // Split large paragraph by sentences
      const sentences = trimmedParagraph.split(/\. /);
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > maxChunkSize) {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
          }
          currentChunk = sentence;
        } else {
          currentChunk += (currentChunk ? '. ' : '') + sentence;
        }
      }
    } else {
      // Check if adding this paragraph exceeds chunk size
      if (currentChunk.length + trimmedParagraph.length > maxChunkSize) {
        chunks.push(currentChunk.trim());
        currentChunk = trimmedParagraph;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + trimmedParagraph;
      }
    }
  }

  // Add remaining chunk
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
