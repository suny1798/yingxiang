package cn.yingxiang.manager;

import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.Map;
import java.util.LinkedHashMap;
import tools.jackson.databind.json.JsonMapper;

/** 只读基础设施审计；不返回连接地址、用户名、凭据或业务行。 */
public final class CloudPreflight {
 public static void main(String[] args) {
  java.util.logging.Logger.getLogger("").setLevel(java.util.logging.Level.OFF);
  Map<String,Object> report=new LinkedHashMap<>(); int exit=1;
  try {
   if(args.length!=1) throw new IllegalArgumentException();
   var config=ConnectionProbe.load(Path.of(args[0])); ConnectionProbe.validate(config);
   try(var connection=DriverManager.getConnection(config.getProperty("spring.datasource.url"),ConnectionProbe.jdbcProperties(config))) {
    connection.setReadOnly(true);connection.setAutoCommit(false);
    try(var statement=connection.prepareStatement("SELECT current_setting('server_version_num')::int, "
      +"coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false), "
      +"r.rolsuper,r.rolcreatedb,r.rolcreaterole,has_database_privilege(current_user,current_database(),'CREATE') "
      +"FROM pg_roles r WHERE rolname=current_user")) {
     statement.setQueryTimeout(5);
     try(var rows=statement.executeQuery()) {
      rows.next();report.put("serverVersionNumber",rows.getInt(1));report.put("postgresTls",rows.getBoolean(2));
      report.put("superuser",rows.getBoolean(3));report.put("canCreateDatabase",rows.getBoolean(4));
      report.put("canCreateRole",rows.getBoolean(5));report.put("canCreateSchema",rows.getBoolean(6));
     }
    }
    String schema=SchemaOperations.schema(config);
    try(var statement=connection.prepareStatement("SELECT version,success FROM \""+schema+"\".flyway_schema_history ORDER BY installed_rank")) {
     statement.setQueryTimeout(5);
     var versions=new java.util.ArrayList<String>();boolean successful=true;
     try(var rows=statement.executeQuery()){while(rows.next()){versions.add(rows.getString(1));successful &= rows.getBoolean(2);}}
     report.put("schemaVersions",versions);report.put("allMigrationsSuccessful",successful);
    }
    connection.rollback();
   }
   report.put("redisTlsConfigured",Boolean.parseBoolean(config.getProperty("spring.data.redis.ssl.enabled","false")));
   report.put("cloudBackupVerified",false);report.put("businessDataRead",false);report.put("writes",false);exit=0;
  } catch(Exception ignored) {report.clear();report.put("code","PREFLIGHT_FAILED_DETAILS_SUPPRESSED");}
  System.out.println(JsonMapper.builder().build().writeValueAsString(report));System.exit(exit);
 }
}
