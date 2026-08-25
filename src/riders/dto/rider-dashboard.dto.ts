export class RiderDashboardDto {
  isOnline: boolean;
  todayEarnings: number;
  tripsDone: number;
  onlineTime: number; // in hours
  completionRate: number; // percentage
  rating: number;
  pendingOrders: number;
  activeCategories: string[]; // e.g., ['food', 'grocery', 'medicine']
}
