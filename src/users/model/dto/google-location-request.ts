import { IsString } from "class-validator";

export class GoogleLocationRequest {
    @IsString()
    readonly longitude: string;
    @IsString()
    readonly latitude: string;
}
