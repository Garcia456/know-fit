/** 对外契约：健康检查响应（本目录下的文件都不许出现全文型字段名） */
export interface HealthResponse {
  status: 'ok';
  service: string;
}