/** 对外契约：健康检查响应（apps/api/src/contracts/ —— ADR-008 护栏 R-B 的管辖范围） */
export interface HealthResponse {
  status: 'ok';
  service: string;
}