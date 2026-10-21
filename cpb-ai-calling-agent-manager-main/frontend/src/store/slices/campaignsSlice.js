import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from '../../utils/axios';

// Async thunks
export const fetchCampaigns = createAsyncThunk(
  'campaigns/fetchCampaigns',
  async (_, { rejectWithValue }) => {
    try {
      console.log('[fetchCampaigns] Starting fetch...');
      const response = await axios.get('/campaigns');
      console.log('[fetchCampaigns] Success:', response.data);
      return response.data.data;
    } catch (error) {
      console.error('[fetchCampaigns] Error:', error.response?.status, error.response?.data);
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch campaigns');
    }
  }
);

export const fetchCampaign = createAsyncThunk(
  'campaigns/fetchCampaign',
  async (id, { rejectWithValue }) => {
    try {
      const response = await axios.get(`/campaigns/${id}`);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch campaign');
    }
  }
);

export const createCampaign = createAsyncThunk(
  'campaigns/createCampaign',
  async (campaignData, { rejectWithValue }) => {
    try {
      console.log('[createCampaign] Sending data:', campaignData);
      const response = await axios.post('/campaigns', campaignData);
      console.log('[createCampaign] Success:', response.data);
      return response.data.data;
    } catch (error) {
      console.error('[createCampaign] Error:', error.response?.status, error.response?.data);
      console.error('[createCampaign] Full error:', error);
      return rejectWithValue(error.response?.data?.message || 'Failed to create campaign');
    }
  }
);

export const updateCampaign = createAsyncThunk(
  'campaigns/updateCampaign',
  async ({ id, data }, { rejectWithValue }) => {
    try {
      const response = await axios.put(`/campaigns/${id}`, data);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update campaign');
    }
  }
);

export const deleteCampaign = createAsyncThunk(
  'campaigns/deleteCampaign',
  async (id, { rejectWithValue }) => {
    try {
      await axios.delete(`/campaigns/${id}`);
      return id;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to delete campaign');
    }
  }
);

export const startCampaign = createAsyncThunk(
  'campaigns/startCampaign',
  async (id, { rejectWithValue }) => {
    try {
      const response = await axios.post(`/campaigns/${id}/start`);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to start campaign');
    }
  }
);

export const pauseCampaign = createAsyncThunk(
  'campaigns/pauseCampaign',
  async (id, { rejectWithValue }) => {
    try {
      const response = await axios.post(`/campaigns/${id}/pause`);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to pause campaign');
    }
  }
);

export const stopCampaign = createAsyncThunk(
  'campaigns/stopCampaign',
  async (id, { rejectWithValue }) => {
    try {
      const response = await axios.post(`/campaigns/${id}/stop`);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to stop campaign');
    }
  }
);

const initialState = {
  campaigns: [],
  currentCampaign: null,
  loading: false,
  error: null,
};

const campaignsSlice = createSlice({
  name: 'campaigns',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    clearCurrentCampaign: (state) => {
      state.currentCampaign = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch campaigns
      .addCase(fetchCampaigns.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCampaigns.fulfilled, (state, action) => {
        state.loading = false;
        state.campaigns = action.payload;
      })
      .addCase(fetchCampaigns.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Fetch single campaign
      .addCase(fetchCampaign.fulfilled, (state, action) => {
        state.currentCampaign = action.payload;
      })
      // Create campaign
      .addCase(createCampaign.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createCampaign.fulfilled, (state, action) => {
        state.loading = false;
        state.campaigns.unshift(action.payload);
      })
      .addCase(createCampaign.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Update campaign
      .addCase(updateCampaign.fulfilled, (state, action) => {
        const index = state.campaigns.findIndex(c => c._id === action.payload._id);
        if (index !== -1) {
          state.campaigns[index] = action.payload;
        }
        if (state.currentCampaign?._id === action.payload._id) {
          state.currentCampaign = action.payload;
        }
      })
      // Delete campaign
      .addCase(deleteCampaign.fulfilled, (state, action) => {
        state.campaigns = state.campaigns.filter(c => c._id !== action.payload);
      })
      // Start campaign
      .addCase(startCampaign.fulfilled, (state, action) => {
        const index = state.campaigns.findIndex(c => c._id === action.payload._id);
        if (index !== -1) {
          state.campaigns[index] = action.payload;
        }
        if (state.currentCampaign?._id === action.payload._id) {
          state.currentCampaign = action.payload;
        }
      })
      // Pause campaign
      .addCase(pauseCampaign.fulfilled, (state, action) => {
        const index = state.campaigns.findIndex(c => c._id === action.payload._id);
        if (index !== -1) {
          state.campaigns[index] = action.payload;
        }
      })
      // Stop campaign
      .addCase(stopCampaign.fulfilled, (state, action) => {
        const index = state.campaigns.findIndex(c => c._id === action.payload._id);
        if (index !== -1) {
          state.campaigns[index] = action.payload;
        }
      });
  },
});

export const { clearError, clearCurrentCampaign } = campaignsSlice.actions;
export default campaignsSlice.reducer;
