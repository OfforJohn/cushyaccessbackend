import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Transactions } from 'src/wallet/model/transaction.entity';
import { startOfDay, endOfDay, subDays } from 'date-fns';

@Injectable()
export class DailyTransactionPercentageUseCase {
  constructor(
    @InjectRepository(Transactions)
    private readonly transactionRepository: Repository<Transactions>,
  ) {}

  async execute() {
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());
    const yesterdayStart = startOfDay(subDays(new Date(), 1));
    const yesterdayEnd = endOfDay(subDays(new Date(), 1));

    const todayTotalObj = await this.transactionRepository
      .createQueryBuilder('t')
      .select('SUM(t.amount)', 'total')
      .where('t.createdAt BETWEEN :start AND :end', {
        start: todayStart,
        end: todayEnd,
      })
      .getRawOne();

    const yesterdayTotalObj = await this.transactionRepository
      .createQueryBuilder('t')
      .select('SUM(t.amount)', 'total')
      .where('t.createdAt BETWEEN :start AND :end', {
        start: yesterdayStart,
        end: yesterdayEnd,
      })
      .getRawOne();

    const todayTotal = parseFloat(todayTotalObj.total) || 0;
    const yesterdayTotal = parseFloat(yesterdayTotalObj.total) || 0;

    let percentageChange = 0;
    if (yesterdayTotal > 0) {
      percentageChange = ((todayTotal - yesterdayTotal) / yesterdayTotal) * 100;
    } else if (todayTotal > 0) {
      percentageChange = 100;
    }

    return {
      todayTotal,
      yesterdayTotal,
      percentageChange: Math.round(percentageChange * 100) / 100,
    };
  }
}
