import { IsIn } from 'class-validator';

export class VoteDto {
  @IsIn(['YES', 'NO', 'BLANK'])
  choice!: 'YES' | 'NO' | 'BLANK';
}
