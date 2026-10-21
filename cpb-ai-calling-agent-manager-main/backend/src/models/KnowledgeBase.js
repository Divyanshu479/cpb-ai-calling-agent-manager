import mongoose from 'mongoose';
import { KNOWLEDGE_BASE_STATUSES } from '../config/constants.js';

const knowledgeBaseSchema = new mongoose.Schema({
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  fileName: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  fileUrl: {
    type: String,
    required: true
  },
  fileType: {
    type: String,
    enum: ['pdf', 'docx', 'txt', 'md'],
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: Object.values(KNOWLEDGE_BASE_STATUSES),
    default: KNOWLEDGE_BASE_STATUSES.PROCESSING
  },
  chunksCount: {
    type: Number,
    default: 0
  },
  vectorIds: [{
    type: String
  }],
  error: {
    type: String
  },
  metadata: {
    title: String,
    author: String,
    description: String,
    tags: [String]
  }
}, {
  timestamps: true
});

// Indexes
knowledgeBaseSchema.index({ createdBy: 1, createdAt: -1 });
knowledgeBaseSchema.index({ status: 1 });

// Method to mark as completed
knowledgeBaseSchema.methods.markCompleted = async function(chunksCount, vectorIds) {
  this.status = KNOWLEDGE_BASE_STATUSES.COMPLETED;
  this.chunksCount = chunksCount;
  this.vectorIds = vectorIds;

  return await this.save();
};

// Method to mark as failed
knowledgeBaseSchema.methods.markFailed = async function(error) {
  this.status = KNOWLEDGE_BASE_STATUSES.FAILED;
  this.error = error;

  return await this.save();
};

const KnowledgeBase = mongoose.model('KnowledgeBase', knowledgeBaseSchema);

export default KnowledgeBase;
