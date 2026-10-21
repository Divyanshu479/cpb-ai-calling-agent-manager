const CampaignFailureAlert = ({ campaign }) => {
  const alert = campaign?.runtimeAlert;
  if (!alert?.active) return null;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-900">
      <p className="text-sm font-semibold">{alert.title || 'Calls are failing'}</p>
      <p className="mt-1 text-sm text-red-800">
        {alert.message || 'Calls are failing before they can be placed. Fix the cause, then restart this campaign.'}
      </p>
      <p className="mt-2 text-xs text-red-700">
        This campaign was paused after {alert.failedCount || 10} failed attempts in a row.
        Add balance or fix the provider error, then start the campaign again.
      </p>
    </div>
  );
};

export default CampaignFailureAlert;
