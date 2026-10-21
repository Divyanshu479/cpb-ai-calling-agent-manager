import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import usersReducer from './slices/usersSlice';
import callersReducer from './slices/callersSlice';
import campaignsReducer from './slices/campaignsSlice';
import leadsReducer from './slices/leadsSlice';
import callLogsReducer from './slices/callLogsSlice';
import knowledgeReducer from './slices/knowledgeSlice';
import campaignSessionsReducer from './slices/campaignSessionsSlice';

const store = configureStore({
  reducer: {
    auth: authReducer,
    users: usersReducer,
    callers: callersReducer,
    campaigns: campaignsReducer,
    leads: leadsReducer,
    callLogs: callLogsReducer,
    knowledge: knowledgeReducer,
    campaignSessions: campaignSessionsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

export default store;
