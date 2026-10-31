package cn.yingxiang.service;

import cn.yingxiang.service.impl.AdministrationServiceImpl;
import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.mapper.MigrationAccounts;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public interface AdministrationService {

    public void authorize(String hashed);

    public Map<String, Object> overview(String hashed);

    public Map<String, Object> listUsers(String hashed, String query, int page);

    public Map<String, Object> records(String hashed, String kind, String query, String state, int page);

    public Map<String, Object> audit(String hashed, int page);

    public Map<String, Object> settingsView(String hashed);

    public Map<String, Object> announcement();

    public Map<String, Object> userChange(String hashed, String ident, JsonNode body);

    public Map<String, Object> creditsChange(String hashed, String ident, JsonNode body);

    public Map<String, Object> settingsChange(String hashed, String key, JsonNode body);

    public static Map<String, Object> validateMutation(JsonNode body, String kind) { return AdministrationServiceImpl.validateMutation(body, kind); }
}
