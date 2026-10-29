package cn.yingxiang.service;

import cn.yingxiang.service.impl.EntitlementReservationServiceImpl;
import cn.yingxiang.exception.BusinessFailure;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.List;
import java.util.UUID;

public interface EntitlementReservationService {

    public void reserve(String hashed, String attemptId, int seconds);

    public boolean confirmIssued(String attemptId);

    public static void validate(String id, int seconds) { EntitlementReservationServiceImpl.validate(id, seconds); }
}
