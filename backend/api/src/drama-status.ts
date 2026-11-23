// 草稿、上架及已下架短剧都可编辑待发布资料。
export const editableDramaStatus = (status: string) => ['DRAFT', 'PUBLISHED', 'OFFLINE'].includes(status);
