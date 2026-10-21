import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from '../../utils/axios';

// Async thunks
export const fetchKnowledgeBases = createAsyncThunk(
  'knowledge/fetchKnowledgeBases',
  async ({ search, status }, { rejectWithValue }) => {
    try {
      const params = {};
      if (search) params.search = search;
      if (status) params.status = status;

      const response = await axios.get('/knowledge', { params });
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch knowledge bases');
    }
  }
);

export const fetchKnowledgeBase = createAsyncThunk(
  'knowledge/fetchKnowledgeBase',
  async (id, { rejectWithValue }) => {
    try {
      const response = await axios.get(`/knowledge/${id}`);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch knowledge base');
    }
  }
);

export const uploadKnowledgeBase = createAsyncThunk(
  'knowledge/uploadKnowledgeBase',
  async ({ file, name, description }, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (name) formData.append('name', name);
      if (description) formData.append('description', description);

      const response = await axios.post('/knowledge', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to upload document');
    }
  }
);

export const updateKnowledgeBase = createAsyncThunk(
  'knowledge/updateKnowledgeBase',
  async ({ id, data }, { rejectWithValue }) => {
    try {
      const response = await axios.put(`/knowledge/${id}`, data);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update knowledge base');
    }
  }
);

export const deleteKnowledgeBase = createAsyncThunk(
  'knowledge/deleteKnowledgeBase',
  async (id, { rejectWithValue }) => {
    try {
      await axios.delete(`/knowledge/${id}`);
      return id;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to delete knowledge base');
    }
  }
);

export const searchKnowledge = createAsyncThunk(
  'knowledge/searchKnowledge',
  async ({ query, knowledgeBaseIds, limit }, { rejectWithValue }) => {
    try {
      const response = await axios.post('/knowledge/search', {
        query,
        knowledgeBaseIds,
        limit,
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to search knowledge base');
    }
  }
);

const initialState = {
  knowledgeBases: [],
  currentKnowledgeBase: null,
  searchResults: [],
  loading: false,
  error: null,
};

const knowledgeSlice = createSlice({
  name: 'knowledge',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    clearSearchResults: (state) => {
      state.searchResults = [];
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch knowledge bases
      .addCase(fetchKnowledgeBases.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchKnowledgeBases.fulfilled, (state, action) => {
        state.loading = false;
        state.knowledgeBases = action.payload.data;
      })
      .addCase(fetchKnowledgeBases.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Fetch single knowledge base
      .addCase(fetchKnowledgeBase.fulfilled, (state, action) => {
        state.currentKnowledgeBase = action.payload;
      })
      // Upload knowledge base
      .addCase(uploadKnowledgeBase.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(uploadKnowledgeBase.fulfilled, (state, action) => {
        state.loading = false;
        state.knowledgeBases.unshift(action.payload);
      })
      .addCase(uploadKnowledgeBase.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Update knowledge base
      .addCase(updateKnowledgeBase.fulfilled, (state, action) => {
        const index = state.knowledgeBases.findIndex((kb) => kb._id === action.payload._id);
        if (index !== -1) {
          state.knowledgeBases[index] = action.payload;
        }
        if (state.currentKnowledgeBase?._id === action.payload._id) {
          state.currentKnowledgeBase = action.payload;
        }
      })
      // Delete knowledge base
      .addCase(deleteKnowledgeBase.fulfilled, (state, action) => {
        state.knowledgeBases = state.knowledgeBases.filter((kb) => kb._id !== action.payload);
      })
      // Search knowledge
      .addCase(searchKnowledge.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(searchKnowledge.fulfilled, (state, action) => {
        state.loading = false;
        state.searchResults = action.payload.data;
      })
      .addCase(searchKnowledge.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { clearError, clearSearchResults } = knowledgeSlice.actions;
export default knowledgeSlice.reducer;