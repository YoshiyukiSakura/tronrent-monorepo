import { FaRotate, FaTrash } from "react-icons/fa6";
import type { RecentOrderEntry } from "@/lib/orderRecovery";

function formatRecentTime(value: string) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "";
  return time.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type RecentOrdersPanelProps = {
  orderId: string;
  recentOrders: RecentOrderEntry[];
  isLoading: boolean;
  error: string | null;
  onOrderIdChange: (value: string) => void;
  onLoad: (orderId: string) => void;
  onForget: (orderId: string) => void;
  onClear: () => void;
};

export default function RecentOrdersPanel({
  orderId,
  recentOrders,
  isLoading,
  error,
  onOrderIdChange,
  onLoad,
  onForget,
  onClear,
}: RecentOrdersPanelProps) {
  const trimmedOrderId = orderId.trim();

  return (
    <div className="mt-5 rounded-md border border-[#30363d] bg-[#0d1117] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="font-semibold">继续追踪订单</h4>
        {recentOrders.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-2 rounded-md border border-[#30363d] px-2 py-1 text-xs text-gray-300 hover:border-[#f05e23] hover:text-white"
          >
            <FaTrash />
            清空
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={orderId}
          onChange={(event) => onOrderIdChange(event.target.value)}
          placeholder="订单号"
          className="min-w-0 flex-1 rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 font-mono text-xs outline-none focus:border-[#f05e23]"
        />
        <button
          type="button"
          onClick={() => onLoad(trimmedOrderId)}
          disabled={isLoading || !trimmedOrderId}
          className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
            isLoading || !trimmedOrderId
              ? "bg-gray-600 cursor-not-allowed"
              : "bg-[#2d3748] hover:bg-[#4a5568]"
          }`}
        >
          <FaRotate />
          {isLoading ? "加载中" : "加载"}
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-red-200">{error}</p>}

      {recentOrders.length > 0 && (
        <div className="mt-4 space-y-2">
          {recentOrders.map((order) => (
            <div
              key={order.id}
              className="flex items-center gap-2 rounded-md border border-[#30363d] bg-[#161b22] p-3"
            >
              <button
                type="button"
                onClick={() => onLoad(order.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate font-mono text-xs text-gray-200">
                  {order.id}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
                  <span>{order.status}</span>
                  {order.amount && <span>{order.amount}</span>}
                  <span>{formatRecentTime(order.updatedAt)}</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onForget(order.id)}
                className="rounded-md border border-[#30363d] px-2 py-2 text-xs text-gray-300 hover:border-[#f05e23] hover:text-white"
                aria-label="移除订单"
              >
                <FaTrash />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
