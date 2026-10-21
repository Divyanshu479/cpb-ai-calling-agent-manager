import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from '../../utils/axios';

// Async thunk
export const fetchCampaignSessions = createAsyncThunk(
  'campaignSessions/fetchCampaignSessions',
  async ({ campaignId, status, callOutcome, interestLevel, extraction, callbackRequested, availabilityOn, hasAvailability, search, sortBy, sortDir, dateFrom, dateTo, durationOp, durationSeconds, durationSecondsTo, limit, offset }, { rejectWithValue }) => {
    try {
      const params = {};
      if (limit) params.limit = limit;
      if (offset) params.offset = offset;
      if (status) params.status = status;
      if (callOutcome) params.callOutcome = callOutcome;
      if (interestLevel !== undefined && interestLevel !== '') params.interestLevel = interestLevel;
      if (extraction) params.extraction = extraction;
      if (callbackRequested) params.callbackRequested = callbackRequested;
      if (availabilityOn) params.availabilityOn = availabilityOn;
      if (hasAvailability) params.hasAvailability = hasAvailability;
      if (search) params.search = search;
      if (sortBy) params.sortBy = sortBy;
      if (sortDir) params.sortDir = sortDir;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (durationOp) params.durationOp = durationOp;
      if (durationSeconds !== undefined && durationSeconds !== '') params.durationSeconds = durationSeconds;
      if (durationSecondsTo !== undefined && durationSecondsTo !== '') params.durationSecondsTo = durationSecondsTo;

      const response = await axios.get(`/campaigns/${campaignId}/sessions`, { params });
      return { 
        data: response.data.data, 
        pagination: response.data.pagination,
        isLoadMore: offset > 0
      };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch campaign sessions');
    }
  }
);

const initialState = {
  sessions: [],
  loading: false,
  loadingMore: false,
  error: null,
  hasMore: false,
  total: 0,
  currentCampaignId: null, // to track if we switched campaigns
  filters: {
    status: '',
    callOutcome: '',
    interestLevel: '',
    extraction: '',
    callbackRequested: '',
    availabilityOn: '',
    hasAvailability: '',
    search: '',
    sortBy: 'createdAt',
    sortDir: 'desc',
    durationOp: 'above',
    durationSeconds: '',
    durationSecondsTo: '',
  }
};

const campaignSessionsSlice = createSlice({
  name: 'campaignSessions',
  initialState,
  reducers: {
    setCampaignSessionsFilters: (state, action) => {
      state.filters = { ...state.filters, ...action.payload };
    },
    clearCampaignSessions: (state) => {
      state.sessions = [];
      state.hasMore = false;
      state.error = null;
    },
    setCurrentCampaignId: (state, action) => {
      if (state.currentCampaignId !== action.payload) {
        state.currentCampaignId = action.payload;
        state.sessions = [];
        state.hasMore = false;
        state.filters = initialState.filters;
      }
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCampaignSessions.pending, (state, action) => {
        const { offset } = action.meta.arg;
        if (offset > 0) {
          state.loadingMore = true;
        } else {
          state.loading = true;
          state.sessions = [];
        }
        state.error = null;
      })
      .addCase(fetchCampaignSessions.fulfilled, (state, action) => {
        state.loading = false;
        state.loadingMore = false;
        
        const newSessions = action.payload.data || [];
        
        if (action.payload.isLoadMore) {
          state.sessions = [...state.sessions, ...newSessions];
        } else {
          state.sessions = newSessions;
        }
        
        state.hasMore = action.payload.pagination?.hasMore || false;
        state.total = action.payload.pagination?.total || 0;
      })
      .addCase(fetchCampaignSessions.rejected, (state, action) => {
        state.loading = false;
        state.loadingMore = false;
        state.error = action.payload;
      });
  },
});

export const { setCampaignSessionsFilters, clearCampaignSessions, setCurrentCampaignId } = campaignSessionsSlice.actions;
export default campaignSessionsSlice.reducer;
