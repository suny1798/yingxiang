package cn.yingxiang.common;

import java.io.Serializable;

/** 按标识删除的通用请求。 */
public class DeleteRequest implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long id;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }
}
