import { IsOptional, IsString, IsInt, Min, Max, Matches, IsEnum, IsIn } from "class-validator";
import { Type } from "class-transformer";
import { PaymentMethod, PaymentStatus } from "@prisma/client";

export class QueryExpenseDto {
  /** Davr: "2026-09" */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: "Davr YYYY-MM korinishida bolsin" })
  period?: string;

  /** Davr oraligi - boshi */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  periodFrom?: string;

  /** Davr oraligi - oxiri */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  periodTo?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  categoryCode?: string;

  /** Ildiz kategoriya boyicha - barcha bolalarini qamrab oladi */
  @IsOptional()
  @IsString()
  rootCategoryCode?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  /** Tolov holati - tolanmaganlarni ajratish uchun */
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  /** Tavsif, kontragent va hujjat boyicha qidiruv */
  @IsOptional()
  @IsString()
  search?: string;

  /** Qaysi ustun boyicha saralash */
  @IsOptional()
  @IsIn(["date", "amountTiyin", "categoryCode", "createdAt"])
  sortBy?: string;

  /** Osish yoki kamayish tartibida */
  @IsOptional()
  @IsIn(["asc", "desc"])
  sortOrder?: "asc" | "desc";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}