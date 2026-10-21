import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from '../../utils/axios';

// Async thunks
export const fetchLeads = createAsyncThunk(
  'leads/fetchLeads',
  async ({ campaignId, params = {} }, { rejectWithValue }) => {
    try {
      const response = await axios.get(`/campaigns/${campaignId}/leads`, { params });
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch leads');
    }
  }
);

export const createLead = createAsyncThunk(
  'leads/createLead',
  async ({ campaignId, leadData }, { rejectWithValue }) => {
    try {
      const response = await axios.post(`/campaigns/${campaignId}/leads`, leadData);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to create lead');
    }
  }
);

export const uploadLeads = createAsyncThunk(
  'leads/uploadLeads',
  async ({ campaignId, file, fieldMapping }, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('fieldMapping', JSON.stringify(fieldMapping));

      const response = await axios.post(`/campaigns/${campaignId}/leads/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to upload leads');
    }
  }
);

export const fetchLeadStats = createAsyncThunk(
  'leads/fetchLeadStats',
  async (campaignId, { rejectWithValue }) => {
    try {
      const response = await axios.get(`/campaigns/${campaignId}/leads/stats`);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch lead stats');
    }
  }
);

export const updateLead = createAsyncThunk(
  'leads/updateLead',
  async ({ id, data }, { rejectWithValue }) => {
    try {
      const response = await axios.put(`/leads/${id}`, data);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update lead');
    }
  }
);

export const deleteLead = createAsyncThunk(
  'leads/deleteLead',
  async (id, { rejectWithValue }) => {
    try {
      await axios.delete(`/leads/${id}`);
      return id;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to delete lead');
    }
  }
);

export const initiateCall = createAsyncThunk(
  'leads/initiateCall',
  async (leadId, { rejectWithValue }) => {
    try {
      const response = await axios.post(`/leads/${leadId}/call`);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to initiate call');
    }
  }
);

const leadsSlice = createSlice({
  name: 'leads',
  initialState: {
    leads: [],
    pagination: {
      total: 0,
      limit: 50,
      offset: 0,
      hasMore: false,
    },
    currentCampaignId: null,
    stats: null,
    currentLead: null,
    loading: false,
    error: null,
    uploadProgress: null,
  },
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    setCurrentLead: (state, action) => {
      state.currentLead = action.payload;
    },
    clearUploadProgress: (state) => {
      state.uploadProgress = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch leads
      .addCase(fetchLeads.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchLeads.fulfilled, (state, action) => {
        state.loading = false;
        state.currentCampaignId = action.meta.arg.campaignId;
        if (action.payload.pagination?.offset > 0) {
          state.leads.push(...action.payload.data);
        } else {
          state.leads = action.payload.data;
        }
        if (action.payload.pagination) {
          state.pagination = action.payload.pagination;
        }
      })
      .addCase(fetchLeads.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Create lead
      .addCase(createLead.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createLead.fulfilled, (state, action) => {
        state.loading = false;
        state.leads.unshift(action.payload);
      })
      .addCase(createLead.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Upload leads
      .addCase(uploadLeads.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.uploadProgress = { status: 'uploading', message: 'Uploading leads...' };
      })
      .addCase(uploadLeads.fulfilled, (state, action) => {
        state.loading = false;
        state.uploadProgress = {
          status: 'success',
          message: action.payload.message,
          data: action.payload.data,
        };
      })
      .addCase(uploadLeads.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
        state.uploadProgress = { status: 'error', message: action.payload };
      })
      // Fetch stats
      .addCase(fetchLeadStats.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchLeadStats.fulfilled, (state, action) => {
        state.loading = false;
        state.stats = action.payload;
      })
      .addCase(fetchLeadStats.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Update lead
      .addCase(updateLead.fulfilled, (state, action) => {
        const index = state.leads.findIndex((lead) => lead._id === action.payload._id);
        if (index !== -1) {
          state.leads[index] = action.payload;
        }
        state.currentLead = action.payload;
      })
      // Delete lead
      .addCase(deleteLead.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteLead.fulfilled, (state, action) => {
        state.loading = false;
        state.leads = state.leads.filter((lead) => lead._id !== action.payload);
      })
      .addCase(deleteLead.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Initiate call
      .addCase(initiateCall.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(initiateCall.fulfilled, (state, action) => {
        state.loading = false;
        // Update lead status to calling
        const index = state.leads.findIndex((lead) => lead._id === action.payload.leadId);
        if (index !== -1) {
          state.leads[index].status = 'calling';
        }
      })
      .addCase(initiateCall.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { clearError, setCurrentLead, clearUploadProgress } = leadsSlice.actions;
export default leadsSlice.reducer;
