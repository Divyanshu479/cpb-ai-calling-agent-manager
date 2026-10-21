import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from '../../utils/axios';

// Async thunks
export const fetchManagers = createAsyncThunk(
  'users/fetchManagers',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axios.get('/admin/managers');
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch managers');
    }
  }
);

export const createManager = createAsyncThunk(
  'users/createManager',
  async (managerData, { rejectWithValue }) => {
    try {
      const response = await axios.post('/admin/managers', managerData);
      // Return the full response data (includes both 'data' and 'credentials')
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to create manager');
    }
  }
);

export const updateManager = createAsyncThunk(
  'users/updateManager',
  async ({ id, data }, { rejectWithValue }) => {
    try {
      const response = await axios.put(`/admin/managers/${id}`, data);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update manager');
    }
  }
);

export const updateManagerLimits = createAsyncThunk(
  'users/updateManagerLimits',
  async ({ id, limits }, { rejectWithValue }) => {
    try {
      const response = await axios.put(`/admin/managers/${id}/limits`, limits);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update limits');
    }
  }
);

export const deleteManager = createAsyncThunk(
  'users/deleteManager',
  async (id, { rejectWithValue }) => {
    try {
      const response = await axios.delete(`/admin/managers/${id}`);
      // Return the updated manager data (with isActive: false)
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to delete manager');
    }
  }
);

const initialState = {
  managers: [],
  loading: false,
  error: null,
};

const usersSlice = createSlice({
  name: 'users',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch managers
      .addCase(fetchManagers.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchManagers.fulfilled, (state, action) => {
        state.loading = false;
        state.managers = action.payload;
      })
      .addCase(fetchManagers.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Create manager
      .addCase(createManager.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createManager.fulfilled, (state, action) => {
        state.loading = false;
        // action.payload contains { data, credentials } - only add data to managers list
        state.managers.unshift(action.payload.data);
      })
      .addCase(createManager.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Update manager
      .addCase(updateManager.fulfilled, (state, action) => {
        const index = state.managers.findIndex(m => m._id === action.payload._id);
        if (index !== -1) {
          state.managers[index] = action.payload;
        }
      })
      // Update manager limits
      .addCase(updateManagerLimits.fulfilled, (state, action) => {
        const index = state.managers.findIndex(m => m._id === action.payload._id);
        if (index !== -1) {
          state.managers[index] = action.payload;
        }
      })
      // Delete manager (actually deactivates)
      .addCase(deleteManager.fulfilled, (state, action) => {
        // Update the manager with isActive: false instead of removing it
        const index = state.managers.findIndex(m => m._id === action.payload._id);
        if (index !== -1) {
          state.managers[index] = action.payload;
        }
      });
  },
});

export const { clearError } = usersSlice.actions;
export default usersSlice.reducer;
