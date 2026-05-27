// Skeleton loader for registry cards
export default function SkeletonRegistryCard() {
  return (
    <div className="block p-5 bg-white rounded-lg shadow-sm border border-gray-200 h-full animate-pulse">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="h-6 bg-gray-200 rounded w-3/4 mb-4"></div>
          
          <div className="flex items-center mt-2 mb-2">
            <div className="h-4 w-4 mr-1.5 bg-gray-200 rounded-full flex-shrink-0"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
          
          <div className="flex items-center mt-4">
            <div className="h-5 w-5 mr-1.5 bg-gray-200 rounded-full flex-shrink-0"></div>
            <div className="h-5 bg-gray-200 rounded w-1/4"></div>
          </div>
        </div>
        <div className="mt-1 ml-2 flex-shrink-0">
          <div className="h-8 w-8 bg-gray-200 rounded-full"></div>
        </div>
      </div>
    </div>
  );
} 