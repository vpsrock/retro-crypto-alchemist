import * as React from 'react';

type DashboardLayoutProps = {
  analysisPanel: React.ReactNode;
  resultsPanel: React.ReactNode;
  ordersPanel: React.ReactNode;
  logPanel: React.ReactNode;
};

export function DashboardLayout({
  analysisPanel,
  resultsPanel,
  ordersPanel,
  logPanel,
}: DashboardLayoutProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full flex-grow">
      <div className="lg:col-span-1 flex flex-col gap-4">
        {analysisPanel}
        {ordersPanel}
      </div>
      <div className="lg:col-span-2 flex flex-col gap-4 min-h-[50vh] lg:min-h-0">
        {resultsPanel}
        {logPanel}
      </div>
    </div>
  );
}
