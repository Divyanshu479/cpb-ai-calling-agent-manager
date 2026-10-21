import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from '../../utils/axios';

// Async thunks
export const fetchProviderCallLogs = createAsyncThunk(
  'callLogs/fetchProviderCallLogs',
  async ({ campaignId, status, callOutcome, dateFrom, dateTo, search, interestLevel, extraction, callbackRequested, availabilityOn, hasAvailability, durationOp, durationSeconds, durationSecondsTo, sortBy, sortDir, limit, offset }, { rejectWithValue }) => {
    try {
      const params = {};
      if (campaignId) params.campaignId = campaignId;
      if (status) params.status = status;
      if (callOutcome) params.callOutcome = callOutcome;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (search) params.search = search;
      if (interestLevel !== undefined && interestLevel !== '') params.interestLevel = interestLevel;
      if (extraction) params.extraction = extraction;
      if (callbackRequested) params.callbackRequested = callbackRequested;
      if (availabilityOn) params.availabilityOn = availabilityOn;
      if (hasAvailability) params.hasAvailability = hasAvailability;
      if (durationOp) params.durationOp = durationOp;
      if (durationSeconds !== undefined && durationSeconds !== '') params.durationSeconds = durationSeconds;
      if (durationSecondsTo !== undefined && durationSecondsTo !== '') params.durationSecondsTo = durationSecondsTo;
      if (sortBy) params.sortBy = sortBy;
      if (sortDir) params.sortDir = sortDir;
      if (limit) params.limit = limit;
      if (offset) params.offset = offset;

      const response = await axios.get('/call-logs/provider', { params });
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch provider call logs');
    }
  }
);

export const fetchProviderCallLog = createAsyncThunk(
  'callLogs/fetchProviderCallLog',
  async (callSid, { rejectWithValue }) => {
    try {
      const response = await axios.get(`/call-logs/provider/${callSid}`);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch provider call log details');
    }
  }
);

export const fetchProviderCallLogsStats = createAsyncThunk(
  'callLogs/fetchProviderCallLogsStats',
  async ({ campaignId, status, callOutcome, dateFrom, dateTo, search, interestLevel, extraction, callbackRequested, availabilityOn, hasAvailability, durationOp, durationSeconds, durationSecondsTo } = {}, { rejectWithValue }) => {
    try {
      const params = {};
      if (campaignId) params.campaignId = campaignId;
      if (status) params.status = status;
      if (callOutcome) params.callOutcome = callOutcome;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (search) params.search = search;
      if (interestLevel !== undefined && interestLevel !== '') params.interestLevel = interestLevel;
      if (extraction) params.extraction = extraction;
      if (callbackRequested) params.callbackRequested = callbackRequested;
      if (availabilityOn) params.availabilityOn = availabilityOn;
      if (hasAvailability) params.hasAvailability = hasAvailability;
      if (durationOp) params.durationOp = durationOp;
      if (durationSeconds !== undefined && durationSeconds !== '') params.durationSeconds = durationSeconds;
      if (durationSecondsTo !== undefined && durationSecondsTo !== '') params.durationSecondsTo = durationSecondsTo;
      const response = await axios.get('/call-logs/provider/stats', { params });
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch provider stats');
    }
  }
);

const initialState = {
  logs: [],
  currentLog: null,
  stats: null,
  pagination: {
    total: 0,
    limit: 50,
    offset: 0,
    hasMore: false,
  },
  filters: {
    campaignId: '',
    status: '',
    callOutcome: '',
    search: '',
    interestLevel: '',
    extraction: '',
    callbackRequested: '',
    availabilityOn: '',
    hasAvailability: '',
    dateFrom: '',
    dateTo: '',
    sortBy: 'createdAt',
    sortDir: 'desc',
    durationOp: 'above',
    durationSeconds: '',
    durationSecondsTo: '',
  },
  loading: false,
  error: null,
};

const callLogsSlice = createSlice({
  name: 'callLogs',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    clearCurrentLog: (state) => {
      state.currentLog = null;
    },
    clearLogs: (state) => {
      state.logs = [];
      state.pagination = initialState.pagination;
    },
    setFilters: (state, action) => {
      state.filters = { ...state.filters, ...action.payload };
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch provider call logs
      .addCase(fetchProviderCallLogs.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchProviderCallLogs.fulfilled, (state, action) => {
        state.loading = false;
        if (action.payload.pagination.offset === 0) {
          state.logs = action.payload.data;
        } else {
          state.logs.push(...action.payload.data);
        }
        state.pagination = action.payload.pagination;
      })
      .addCase(fetchProviderCallLogs.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Fetch single provider call log
      .addCase(fetchProviderCallLog.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchProviderCallLog.fulfilled, (state, action) => {
        state.loading = false;
        state.currentLog = action.payload;
      })
      .addCase(fetchProviderCallLog.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Fetch stats
      .addCase(fetchProviderCallLogsStats.fulfilled, (state, action) => {
        state.stats = action.payload;
      });
  },
});

export const { clearError, clearCurrentLog, clearLogs, setFilters } = callLogsSlice.actions;
export default callLogsSlice.reducer;
