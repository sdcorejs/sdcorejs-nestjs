import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, HasPermission } from '@sdcorejs/nestjs/auth';
import { ApiResponse } from '@sdcorejs/nestjs/core';
import { Cached } from '@sdcorejs/nestjs/services';
import { ZodValidationGuard, zPaging } from '@sdcorejs/nestjs/validation';
import { Product } from './product.entity';
import { ProductRepository } from './product.repository';

const createProductSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(256),
  priceCents: z.number().int().nonnegative(),
});

const listProductsSchema = zPaging;

type CreateProductRequest = z.infer<typeof createProductSchema>;
type ListProductsQuery = z.infer<typeof listProductsSchema>;

interface ProductDto {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  createdAt: string;
}

@Controller('products')
export class ProductController {
  constructor(private readonly products: ProductRepository) {}

  @Get()
  @HasPermission('catalog_product:read')
  @UseGuards(AuthGuard, ZodValidationGuard(listProductsSchema, 'query'))
  @Cached({ scope: 'tenant', ttl: 60, keyResolver: ({ query }) => query })
  async list(@Query() query: ListProductsQuery) {
    const page = await this.products.paging({
      pageNumber: query.pageNumber,
      pageSize: query.pageSize,
    });
    return ApiResponse.ok({
      items: page.items.map((product) => this.toDto(product)),
      total: page.total,
    });
  }

  @Post()
  @HasPermission('catalog_product:create')
  @UseGuards(AuthGuard, ZodValidationGuard(createProductSchema))
  async create(@Body() body: CreateProductRequest) {
    const product = await this.products.create(body);
    return ApiResponse.ok(this.toDto(product));
  }

  private toDto(product: Product): ProductDto {
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      priceCents: product.priceCents,
      createdAt: product.createdAt.toISOString(),
    };
  }
}
