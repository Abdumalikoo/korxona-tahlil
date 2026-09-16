import { IsString, IsInt, IsOptional, IsBoolean, Min, MaxLength } from "class-validator";

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  index?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  allocationWeight?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}