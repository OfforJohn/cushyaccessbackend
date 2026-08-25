export enum OrderStatus {
  pending = 'PENDING', //default status when order is created
  acknoledged = 'ACKNOWLEDGED', // when the vendor acknowledges(accept) the order
  rejected = 'REJECTED', // when the vendor reject the order
  picked_up = 'PICKED_UP', // when the rider picks up the order from the vendor
  delivered = 'DELIVERED', //(final step) when the rider delivers the order to the customer 
  cancelled = 'CANCELLED',
  in_transit = 'IN_TRANSIT', // when the rider is on the way to deliver the order to the customer
}
