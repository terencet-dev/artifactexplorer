// Skeleton loader for repository and registry cards
export default function SkeletonCard({ showRegistry = false }: { showRegistry?: boolean }) {
  return (
    <div className="block p-5 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 h-full animate-pulse">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
          {showRegistry && (
            <div className="flex items-center mt-2">
              <div className="h-4 w-4 mr-1.5 bg-gray-200 dark:bg-gray-700 rounded-full flex-shrink-0"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
            </div>
          )}
        </div>
        <div className="mt-1 ml-2 flex-shrink-0">
          <div className="h-5 w-5 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    </div>
  );
} 