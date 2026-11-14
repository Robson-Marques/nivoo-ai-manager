import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

@Controller('projects/:pid/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.conversations.list(pid);
  }

  @Post()
  create(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    return this.conversations.create(pid, body);
  }

  @Get(':cid')
  get(@Param('pid', ParseUUIDPipe) pid: string, @Param('cid', ParseUUIDPipe) cid: string) {
    return this.conversations.get(pid, cid);
  }

  @Post(':cid/messages')
  send(@Param('pid', ParseUUIDPipe) pid: string, @Param('cid', ParseUUIDPipe) cid: string, @Body() body: any) {
    return this.conversations.send(pid, cid, body);
  }

  @Post(':cid/messages/:mid/approve')
  approve(@Param('pid', ParseUUIDPipe) pid: string, @Param('cid', ParseUUIDPipe) cid: string, @Param('mid', ParseUUIDPipe) mid: string, @Body() body: any) {
    return this.conversations.approve(pid, cid, mid, body);
  }
}
