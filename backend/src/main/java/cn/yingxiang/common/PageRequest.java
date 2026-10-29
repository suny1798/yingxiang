package cn.yingxiang.common;

import java.io.Serializable;

/** 分页请求基础参数。 */
public class PageRequest implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 当前页号，从 1 开始。 */
    private int current = 1;

    /** 页面大小。 */
    private int pageSize = 10;

    /** 排序字段。 */
    private String sortField;

    /** 排序顺序，默认降序。 */
    private String sortOrder = "descend";

    public int getCurrent() {
        return current;
    }

    public void setCurrent(int current) {
        this.current = current;
    }

    public int getPageSize() {
        return pageSize;
    }

    public void setPageSize(int pageSize) {
        this.pageSize = pageSize;
    }

    public String getSortField() {
        return sortField;
    }

    public void setSortField(String sortField) {
        this.sortField = sortField;
    }

    public String getSortOrder() {
        return sortOrder;
    }

    public void setSortOrder(String sortOrder) {
        this.sortOrder = sortOrder;
    }
}
