import { Injectable, NotFoundException } from "@nestjs/common";
import { Repository } from "typeorm";
import { VendorCategory } from "../model/vendor-category.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { CreateVendorCategoryDto } from "../model/dto/create-vendor-category.dto";
import { UpdateVendorCategoryDto } from "../model/dto/update-vendor-category.dto";

@Injectable()
export class VendorCategoryService {
    constructor( @InjectRepository(VendorCategory) private readonly vendorCategoryRepo: Repository<VendorCategory> ) {}
    async getAllCategories() {
        return this.vendorCategoryRepo.find();
    }
    async findByKey(key: string): Promise<VendorCategory | null> {
        return this.vendorCategoryRepo.findOne({ where: { key } });
    }

    async create(data: CreateVendorCategoryDto): Promise<VendorCategory> {
        const category = this.vendorCategoryRepo.create({
            key: data.key,
            title: data.title,
            url: data.url,
            color: data.color,
            isAvailable: data.isAvailable ?? true, // Default to true if not provided
        });
        return this.vendorCategoryRepo.save(category);
    }

    async update(id: string, data: Partial<UpdateVendorCategoryDto>): Promise<VendorCategory> {
        const category = await this.vendorCategoryRepo.findOne({ where: { id } });
        if (!category) {
        throw new NotFoundException('Vendor category not found');
        }

        Object.assign(category, data);
        return this.vendorCategoryRepo.save(category);
    }

    async delete(id: string): Promise<void> {
        const result = await this.vendorCategoryRepo.delete(id);
        if (result.affected === 0) {
            throw new NotFoundException('Vendor category not found');
        }
    }
}