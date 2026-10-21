import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from '../../utils/axios';

// Async thunks
export const fetchCallers = createAsyncThunk(
  'callers/fetchCallers',
  async (_, { rejectWithValue }) => {
    try {
      console.log('[fetchCallers] Starting fetch...');
      const response = await axios.get('/callers');
      console.log('[fetchCallers] Success:', response.data);
      return response.data.data;
    } catch (error) {
      console.error('[fetchCallers] Error:', error.response?.status, error.response?.data);
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch callers');
    }
  }
);

export const fetchCaller = createAsyncThunk(
  'callers/fetchCaller',
  async (id, { rejectWithValue }) => {
    try {
      const response = await axios.get(`/callers/${id}`);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch caller');
    }
  }
);

export const createCaller = createAsyncThunk(
  'callers/createCaller',
  async (callerData, { rejectWithValue }) => {
    try {
      console.log('[createCaller] Sending data:', callerData);
      const response = await axios.post('/callers', callerData);
      console.log('[createCaller] Success:', response.data);
      return response.data.data;
    } catch (error) {
      console.error('[createCaller] Error:', error.response?.status, error.response?.data);
      console.error('[createCaller] Full error:', error);
      return rejectWithValue(error.response?.data?.message || 'Failed to create caller');
    }
  }
);

export const updateCaller = createAsyncThunk(
  'callers/updateCaller',
  async ({ id, data }, { rejectWithValue }) => {
    try {
      const response = await axios.put(`/callers/${id}`, data);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update caller');
    }
  }
);

export const updateCallerScript = createAsyncThunk(
  'callers/updateCallerScript',
  async ({ id, nodes, edges }, { rejectWithValue }) => {
    try {
      const response = await axios.put(`/callers/${id}/script`, { nodes, edges });
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update script');
    }
  }
);

export const deleteCaller = createAsyncThunk(
  'callers/deleteCaller',
  async (id, { rejectWithValue }) => {
    try {
      await axios.delete(`/callers/${id}`);
      return id;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to delete caller');
    }
  }
);

const initialState = {
  callers: [],
  currentCaller: null,
  loading: false,
  error: null,
};

const callersSlice = createSlice({
  name: 'callers',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    clearCurrentCaller: (state) => {
      state.currentCaller = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch callers
      .addCase(fetchCallers.pending, (state) => {
        console.log('[fetchCallers.pending] Setting loading = true');
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCallers.fulfilled, (state, action) => {
        console.log('[fetchCallers.fulfilled] Setting loading = false, callers count:', action.payload?.length);
        state.loading = false;
        state.callers = action.payload;
      })
      .addCase(fetchCallers.rejected, (state, action) => {
        console.log('[fetchCallers.rejected] Setting loading = false, error:', action.payload);
        state.loading = false;
        state.error = action.payload;
      })
      // Fetch single caller
      .addCase(fetchCaller.fulfilled, (state, action) => {
        state.currentCaller = action.payload;
      })
      // Create caller
      .addCase(createCaller.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createCaller.fulfilled, (state, action) => {
        state.loading = false;
        state.callers.unshift(action.payload);
      })
      .addCase(createCaller.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Update caller
      .addCase(updateCaller.fulfilled, (state, action) => {
        const index = state.callers.findIndex(c => c._id === action.payload._id);
        if (index !== -1) {
          state.callers[index] = action.payload;
        }
        if (state.currentCaller?._id === action.payload._id) {
          state.currentCaller = action.payload;
        }
      })
      // Update caller script
      .addCase(updateCallerScript.fulfilled, (state, action) => {
        if (state.currentCaller?._id === action.payload._id) {
          state.currentCaller = action.payload;
        }
      })
      // Delete caller
      .addCase(deleteCaller.fulfilled, (state, action) => {
        state.callers = state.callers.filter(c => c._id !== action.payload);
      });
  },
});

export const { clearError, clearCurrentCaller } = callersSlice.actions;
export default callersSlice.reducer;
